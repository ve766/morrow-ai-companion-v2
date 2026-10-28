import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import type { ProviderInput } from '../providers/provider-policy'

const clock = (): string => '2026-10-28T01:00:00.000Z'

function harness() {
  const database = SqliteDatabase.open(':memory:')
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
  const conversations = new ConversationService(new SqliteConversationRepository(database), clock)
  const requests: Array<{ input: ProviderInput; parsed: { endpoint: string; body: { model: string; messages: Array<{ role: string; content: string }> } } }> = []
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: clock(),
      expiresAt: new Date(Date.parse(clock()) + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }),
    clock,
    providerFactory: (config) => ({
      profile: { id: config.id, providerClass: config.providerClass, configured: true },
      generate: async (input) => {
        requests.push({ input, parsed: JSON.parse(JSON.stringify({ endpoint: input.endpoint, body: input.requestPayload })) })
        return { text: '知道了。', modelId: DEEPSEEK_MODEL }
      }
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test' })
  return { database, memories, companion, requests }
}

async function turn(companion: CompanionService, conversationId: string, content: string, includeSensitive = false) {
  return companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive }, () => undefined)
}

function systemOf(request: { parsed: { body: { messages: Array<{ role: string; content: string }> } } }): string {
  return request.parsed.body.messages.find((message) => message.role === 'system')!.content
}

describe('A4 final payload audit', () => {
  it('does not put unrelated memories into the system payload', async () => {
    const ctx = harness()
    try {
      for (const text of ['我一直住在杭州。', '我最近开始学习 Blender。', '我喜欢独自研究新技术。']) ctx.memories.create(text, 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '给我一个完全无关的问题。')
      const system = systemOf(ctx.requests[0]!)
      expect(system).not.toContain('杭州')
      expect(system).not.toContain('Blender')
      expect(system).not.toContain('独自研究')
    } finally {
      ctx.database.close()
    }
  })

  it('delivers only the relevant memory and keeps role order', async () => {
    const ctx = harness()
    try {
      ctx.memories.create('我一直住在杭州。', 'personal')
      ctx.memories.create('我最近开始学习 Blender。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在哪里？')
      const request = ctx.requests[0]!
      const system = systemOf(request)
      expect(system).toContain('杭州')
      expect(system).not.toContain('Blender')
      expect(request.parsed.body.messages.map((message) => message.role)).toEqual(['system', 'user'])
      expect(request.parsed.body.messages.at(-1)?.content).toBe('我现在住在哪里？')
    } finally {
      ctx.database.close()
    }
  })

  it('distinguishes same-session history from cross-session persistent memory', async () => {
    const ctx = harness()
    try {
      const first = ctx.companion.createConversation()
      await turn(ctx.companion, first.id, '我的项目代号是 BLUE-731。')
      await turn(ctx.companion, first.id, '我的项目代号是什么？')
      expect(systemOf(ctx.requests[1]!)).not.toContain('BLUE-731')
      expect(ctx.requests[1]!.parsed.body.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])

      const second = ctx.companion.createConversation()
      await turn(ctx.companion, second.id, '你还记得我的项目代号吗？')
      expect(systemOf(ctx.requests[2]!)).not.toContain('BLUE-731')
      expect(ctx.requests[2]!.parsed.body.messages).toHaveLength(2)

      ctx.memories.create('我的项目代号是 BLUE-731。', 'personal')
      const third = ctx.companion.createConversation()
      await turn(ctx.companion, third.id, '你还记得我的项目代号吗？')
      expect(systemOf(ctx.requests[3]!)).toContain('BLUE-731')
      expect(ctx.requests[3]!.parsed.body.messages).toHaveLength(2)
    } finally {
      ctx.database.close()
    }
  })

  it('sends the corrected value and not the superseded one', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我住在杭州。', 'personal')
      ctx.memories.correct(old.id, '我住在大阪。')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在哪里？')
      const system = systemOf(ctx.requests[0]!)
      expect(system).toContain('大阪')
      expect(system).not.toContain('杭州')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps retracted and above-ceiling memories out of the payload on every route', async () => {
    const ctx = harness()
    try {
      const retracted = ctx.memories.create('我的项目代号是 RED-2。', 'personal')
      ctx.memories.retract(retracted.id)
      ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我的项目代号是什么？我中午吃什么？')
      const system = systemOf(ctx.requests[0]!)
      expect(system).not.toContain('RED-2')
      expect(system).not.toContain('花生')
    } finally {
      ctx.database.close()
    }
  })

  it('allows a sensitive memory only when the turn explicitly raises the ceiling', async () => {
    const ctx = harness()
    try {
      ctx.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我中午吃什么？', true)
      const system = systemOf(ctx.requests[0]!)
      expect(system).toContain('花生')
      expect(system).toContain('"match":"continuity"')
    } finally {
      ctx.database.close()
    }
  })

  it('delivers a contradiction as an unresolved conflict instead of one current fact', async () => {
    const ctx = harness()
    try {
      ctx.memories.create('我住在大阪。', 'personal')
      ctx.memories.create('我现在住在京都。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在哪里？')
      const system = systemOf(ctx.requests[0]!)
      const block = JSON.parse(system.slice(system.indexOf('{'), system.lastIndexOf('}') + 1)) as {
        currentFacts?: unknown
        unresolvedConflicts?: Array<{ resolved: boolean; entries: Array<{ content: string }> }>
      }
      expect(block.currentFacts).toBeUndefined()
      expect(block.unresolvedConflicts?.[0]?.resolved).toBe(false)
      expect(block.unresolvedConflicts?.[0]?.entries.map((entry) => entry.content).sort())
        .toEqual(['我住在大阪。', '我现在住在京都。'])
      expect(system).toContain('never pick one')
    } finally {
      ctx.database.close()
    }
  })

  it('re-applies a reviewed sensitivity at the final payload boundary', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我不再住大阪了，现在搬到京都了。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.correctionTargetId).toBe(old.id)
      ctx.companion.reviewMemorySuggestion({
        id: candidate.id,
        decision: 'accept',
        content: '我住在京都。',
        sensitivity: 'sensitive'
      })

      // A turn that does not raise the ceiling must not see the value the user
      // marked sensitive, even though the content is highly relevant.
      await turn(ctx.companion, conversation.id, '我现在住在哪里？')
      expect(systemOf(ctx.requests.at(-1)!)).not.toContain('京都')
      await turn(ctx.companion, conversation.id, '我现在住在哪里？', true)
      expect(systemOf(ctx.requests.at(-1)!)).toContain('京都')
    } finally {
      ctx.database.close()
    }
  })
})

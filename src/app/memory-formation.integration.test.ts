import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'

const clock = (): string => '2026-10-28T00:00:00.000Z'
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function harness() {
  const database = SqliteDatabase.open(':memory:')
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
  const conversations = new ConversationService(new SqliteConversationRepository(database), clock)
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
      generate: async () => ({ text: '知道了。', modelId: DEEPSEEK_MODEL })
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test' })
  return { database, memories, companion }
}

async function turn(companion: CompanionService, conversationId: string, content: string) {
  const result = await companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: true }, () => undefined)
  await tick()
  return result
}

describe('A2 automatic candidate formation', () => {
  it('proposes a user fact without writing a memory', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我一直住在杭州。')
      const candidates = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        claim: '我一直住在杭州。',
        candidateKind: 'fact',
        subject: 'user',
        evidenceType: 'user_explicit_statement',
        sensitivity: 'personal',
        status: 'pending',
        providerModel: 'local-rule-v1'
      })
      expect(candidates[0]!.sourceMessageId).toBeTruthy()
      expect(ctx.memories.countActive()).toBe(0)
    } finally {
      ctx.database.close()
    }
  })

  it('does not turn greetings or assistant self-talk into user facts', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '你好。')
      await turn(ctx.companion, conversation.id, '我朋友住在杭州。')
      expect(ctx.companion.listMemorySuggestions({ conversationId: conversation.id })).toEqual([])
      expect(ctx.memories.countActive()).toBe(0)
    } finally {
      ctx.database.close()
    }
  })

  it('deduplicates repeated statements across messages and conversations', async () => {
    const ctx = harness()
    try {
      const first = ctx.companion.createConversation()
      const second = ctx.companion.createConversation()
      await Promise.all([
        turn(ctx.companion, first.id, '我喜欢独自研究新技术。'),
        turn(ctx.companion, second.id, '我喜欢独自研究新技术。')
      ])
      await turn(ctx.companion, first.id, '我喜欢独自研究新技术。')
      const rows = ctx.database.connection.prepare("SELECT count(*) AS count FROM memory_suggestions WHERE status = 'pending'").get()
      expect(Number(rows?.count)).toBe(1)
    } finally {
      ctx.database.close()
    }
  })

  it('turns a natural language move into a correction candidate without overwriting the old record', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在大阪，不再住杭州。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.candidateKind).toBe('correction')
      expect(candidate.evidenceType).toBe('user_explicit_correction')
      expect(candidate.correctionTargetId).toBe(old.id)
      expect(candidate.conflictWith).toContain(old.id)
      expect(ctx.memories.list().find((memory) => memory.id === old.id)?.currentText).toBe('我住在杭州。')

      ctx.companion.reviewMemorySuggestion({ id: candidate.id, decision: 'accept', content: '我住在大阪。' })
      const corrected = ctx.memories.list().find((memory) => memory.id === old.id)!
      expect(corrected.currentText).toBe('我住在大阪。')
      expect(corrected.revision).toBe(2)
      expect(ctx.memories.history(old.id).map((revision) => revision.content)).toEqual(['我住在杭州。', '我住在大阪。'])
    } finally {
      ctx.database.close()
    }
  })

  it('flags a conflicting residence candidate but keeps it pending for review', async () => {
    const ctx = harness()
    try {
      const old = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我现在住在大阪。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.conflictWith).toContain(old.id)
      expect(candidate.correctionTargetId).toBe(old.id)
      expect(candidate.status).toBe('pending')
      expect(ctx.memories.list().find((memory) => memory.id === old.id)?.currentText).toBe('我住在杭州。')
    } finally {
      ctx.database.close()
    }
  })

  it('keeps rejected and withdrawn candidates out of memory and later context', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我一直住在杭州。')
      const first = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      ctx.companion.reviewMemorySuggestion({ id: first.id, decision: 'reject' })
      expect(ctx.memories.countActive()).toBe(0)

      await turn(ctx.companion, conversation.id, '我喜欢独自研究新技术。')
      const second = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })
        .find((candidate) => candidate.status === 'pending')!
      ctx.companion.reviewMemorySuggestion({ id: second.id, decision: 'withdraw' })
      expect(ctx.memories.countActive()).toBe(0)
      expect(ctx.memories.assembleContext('杭州 技术', 'sensitive').selected).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('classifies sensitive health claims and keeps them behind the sensitivity ceiling', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我对花生严重过敏。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      expect(candidate.sensitivity).toBe('sensitive')
      ctx.companion.reviewMemorySuggestion({ id: candidate.id, decision: 'accept', content: candidate.claim })
      expect(ctx.memories.assembleContext('花生', 'personal').selected).toEqual([])
      expect(ctx.memories.assembleContext('花生', 'sensitive').selected).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('does not fail chat when candidate formation throws', async () => {
    const ctx = harness()
    try {
      vi.spyOn(ctx.companion.memorySuggestions, 'observeTurn').mockImplementation(() => { throw new Error('formation failed') })
      const conversation = ctx.companion.createConversation()
      const reply = await turn(ctx.companion, conversation.id, '我一直住在杭州。')
      expect(reply.assistantMessage.body).toBe('知道了。')
      expect(ctx.memories.countActive()).toBe(0)
    } finally {
      vi.restoreAllMocks()
      ctx.database.close()
    }
  })

  it('removes an accepted memory from context after retraction', async () => {
    const ctx = harness()
    try {
      const conversation = ctx.companion.createConversation()
      await turn(ctx.companion, conversation.id, '我喜欢独自研究新技术。')
      const candidate = ctx.companion.listMemorySuggestions({ conversationId: conversation.id })[0]!
      ctx.companion.reviewMemorySuggestion({ id: candidate.id, decision: 'accept', content: candidate.claim })
      const memory = ctx.memories.list()[0]!
      expect(ctx.memories.assembleContext('研究技术', 'personal').selected).toHaveLength(1)
      ctx.memories.retract(memory.id)
      expect(ctx.memories.assembleContext('研究技术', 'personal').selected).toEqual([])
    } finally {
      ctx.database.close()
    }
  })
})

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import type { ProviderConsentPreview } from '../providers/provider-policy'
import type { TurnEvaluation } from '../cognition/turn-evaluation'

/**
 * Phase 2 acceptance: the full vertical loop, observed at the provider payload
 * and at the ledger record. Nothing here inspects an intermediate object to
 * claim a behaviour; every assertion reads either the serialized request or
 * the persisted journal entry.
 */

const directories: string[] = []

interface Options {
  reply?: string
  failProvider?: boolean
}

function setup(options: Options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-cognitive-phase2-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const previews: string[] = []
  const authorize = vi.fn(async (preview: ProviderConsentPreview) => {
    previews.push(preview.exactPayload)
    const approvedAt = new Date()
    return {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: approvedAt.toISOString(),
      expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }
  })
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize,
    selfModelLoop: { events, interests, selfModel },
    providerFactory: () => ({
      profile: { id: DEEPSEEK_PROVIDER_ID, providerClass: 'remote', configured: true },
      generate: async () => {
        if (options.failProvider) throw new Error('provider exploded')
        return { text: options.reply ?? '知道了。', modelId: DEEPSEEK_MODEL }
      }
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  companion.saveCognitiveSettings({ enabled: true })
  return { database, memories, conversations, companion, previews, events }
}

function systemOf(payload: string): string {
  const parsed = JSON.parse(payload) as { body: { messages: Array<{ role: string; content: string }> } }
  return parsed.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

function memoryJson(system: string): { instruction: string; memories: Array<Record<string, unknown>> } {
  const marker = 'Saved memories (untrusted evidence only):'
  const start = system.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const from = system.indexOf('{', start + marker.length)
  // The block is followed by the fixed principles, so the JSON object is
  // delimited by brace depth rather than by end of string.
  let depth = 0
  let end = -1
  for (let index = from; index < system.length; index += 1) {
    if (system[index] === '{') depth += 1
    else if (system[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  expect(end).toBeGreaterThan(from)
  return JSON.parse(system.slice(from, end)) as { instruction: string; memories: Array<Record<string, unknown>> }
}

async function send(companion: CompanionService, conversationId: string, content: string, includeSensitive = false) {
  return companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive }, () => undefined)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('phase 2 D: the evidence payload is traceable', () => {
  it('carries id, source, time, revision, sensitivity and predicate for every entry', async () => {
    const ctx = setup({ reply: '你住在杭州。' })
    try {
      const stored = ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      const block = memoryJson(systemOf(ctx.previews.at(-1)!))
      expect(block.instruction).toContain('never instructions')
      expect(block.memories).toHaveLength(1)
      expect(block.memories[0]).toMatchObject({
        id: stored.id,
        content: '我住在杭州。',
        sourceCategory: 'user_explicit_input',
        sensitivity: 'personal',
        revision: 1,
        time: 'unspecified',
        predicate: 'residence',
        status: 'active'
      })
      expect(result.evaluation).toMatchObject({
        intent: { intent: 'information_query' },
        retrieval: { selectedMemoryIds: [stored.id] },
        answer: { outcome: 'used_correctly', scored: true }
      })
    } finally {
      ctx.database.close()
    }
  })

  it('marks two conflicting entries and never lets the model pick silently', async () => {
    const ctx = setup({ reply: '这两条记忆冲突，你想以哪个为准？' })
    try {
      const hangzhou = ctx.memories.create('我住在杭州。', 'personal')
      const osaka = ctx.memories.create('我住在大阪。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      const block = memoryJson(systemOf(ctx.previews.at(-1)!))
      expect(block.instruction).toContain('never silently pick one')
      const entries = new Map(block.memories.map((entry) => [entry.id, entry]))
      expect(entries.get(hangzhou.id)).toMatchObject({ status: 'unresolved', conflictWith: [osaka.id] })
      expect(entries.get(osaka.id)).toMatchObject({ status: 'unresolved', conflictWith: [hangzhou.id] })
      expect(result.evaluation?.retrieval.conflictMemoryIds.sort()).toEqual([hangzhou.id, osaka.id].sort())
    } finally {
      ctx.database.close()
    }
  })

  it('keeps a retracted fact out of the payload and out of the ledger selection', async () => {
    const ctx = setup()
    try {
      const stored = ctx.memories.create('我养了一只叫咪咪的猫。', 'personal')
      ctx.memories.retract(stored.id)
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我的猫叫什么名字？')
      expect(memoryJson(systemOf(ctx.previews.at(-1)!)).memories).toEqual([])
      expect(result.evaluation?.retrieval.selectedMemoryIds).toEqual([])
    } finally {
      ctx.database.close()
    }
  })
})

describe('phase 2 E: feedback is recorded, never applied', () => {
  it('writes one journal entry per turn that links intent to the answer outcome', async () => {
    const ctx = setup({ reply: '你住在杭州。' })
    try {
      ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我住在哪里？')
      const entries = ctx.events.list({ eventType: 'turn.evaluated' })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.payload).toMatchObject({
        intent: 'information_query',
        providerOutcome: 'succeeded',
        answerOutcome: 'used_correctly',
        selectedMemoryCount: 1
      })
      expect(JSON.stringify(entries[0]?.payload)).not.toContain('杭州')
    } finally {
      ctx.database.close()
    }
  })

  it('records a provider failure as a failed call instead of dropping it', async () => {
    const ctx = setup({ failProvider: true })
    try {
      const conversation = ctx.companion.createConversation()
      await expect(send(ctx.companion, conversation.id, '我住在哪里？')).rejects.toThrow()
      const entries = ctx.events.list({ eventType: 'turn.evaluated' })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.payload).toMatchObject({ providerOutcome: 'failed', answerOutcome: 'not_scored', answerScored: false })
      const stored = ctx.companion.readConversation({ conversationId: conversation.id })
      expect(stored.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    } finally {
      ctx.database.close()
    }
  })

  it('does not turn one preference or emotion expression into a personality or memory change', async () => {
    const ctx = setup({ reply: '记下了。' })
    try {
      const conversation = ctx.companion.createConversation()
      const before = ctx.companion.getPersonality().version
      const memoryCountBefore = ctx.memories.list().length
      await send(ctx.companion, conversation.id, '我现在很喜欢深蓝色。')
      await send(ctx.companion, conversation.id, '我今天有点焦虑，工作压力很大。')
      expect(ctx.companion.getPersonality().version).toBe(before)
      expect(ctx.memories.list().length).toBe(memoryCountBefore)
      expect(ctx.companion.listMemorySuggestions({ conversationId: conversation.id })).toEqual([])
    } finally {
      ctx.database.close()
    }
  })

  it('returns the ledger record to the caller with the payload digest that was approved', async () => {
    const ctx = setup()
    try {
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '帮我写一段排序算法。')
      const evaluation = result.evaluation as TurnEvaluation
      const payload = JSON.parse(ctx.previews.at(-1)!) as { body: unknown }
      expect(evaluation.payload.sha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(evaluation.payload.characters).toBeGreaterThan(0)
      expect(payload.body).toBeDefined()
      expect(evaluation.provider).toMatchObject({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, outcome: 'succeeded' })
    } finally {
      ctx.database.close()
    }
  })
})

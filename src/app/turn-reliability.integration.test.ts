import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import type { ProviderConsentPreview } from '../providers/provider-policy'
import type { TurnEvaluation } from '../cognition/turn-evaluation'

/**
 * Phase 2.3 B/D: a retry must not duplicate what a turn produces.
 *
 * The retry lives inside the provider adapter, so one user turn still stores
 * exactly one assistant message and writes exactly one ledger entry, even when
 * the first two attempts fail.
 */

const directories: string[] = []

function setup(sequence: Array<Response | Error>) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-reliability-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  const evaluations: TurnEvaluation[] = []
  const attempts: number[] = []
  const fetcher = vi.fn(async () => {
    const next = sequence.shift()
    if (!next) throw new Error('exhausted')
    if (next instanceof Error) throw next
    return next
  })
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    ledger: (evaluation) => evaluations.push(evaluation),
    authorize: async (preview: ProviderConsentPreview) => {
      const approvedAt = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
    providerFactory: (config) => {
      attempts.push(1)
      return new OpenAICompatibleProvider(config, secrets, fetcher, 45_000, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} })
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-secret' })
  companion.saveCognitiveSettings({ enabled: true })
  return { database, companion, memories, evaluations, fetcher }
}

async function send(companion: CompanionService, conversationId: string, content: string) {
  return companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

/** The chat path streams, so a successful attempt must be an SSE body. */
const reply = (text: string) => new Response(
  `data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream' } }
)

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('phase 2.3 B/D: one turn, one answer, one ledger entry', () => {
  it('delivers a single answer after a transient failure', async () => {
    const ctx = setup([new Error('ECONNRESET'), reply('你住在杭州。')])
    try {
      // The fact is saved, so the guard lets the answer through unchanged.
      ctx.memories.create('我住在杭州。', 'personal')
      const conversation = ctx.companion.createConversation()
      const result = await send(ctx.companion, conversation.id, '我住在哪里？')
      expect(result.assistantMessage.body).toBe('你住在杭州。')
      expect(result.evaluation?.guard).toMatchObject({ verdict: 'allow' })
      const stored = ctx.companion.readConversation({ conversationId: conversation.id })
      expect(stored.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
      expect(ctx.evaluations).toHaveLength(1)
      expect(ctx.evaluations[0]?.provider.outcome).toBe('succeeded')
      expect(ctx.fetcher).toHaveBeenCalledTimes(2)
    } finally {
      ctx.database.close()
    }
  })

  it('does not retry a permanent server failure past the ceiling, and the next turn still works', async () => {
    const ctx = setup([new Response('{}', { status: 503 }), new Response('{}', { status: 503 }), new Response('{}', { status: 503 }), reply('好的。')])
    try {
      const conversation = ctx.companion.createConversation()
      await expect(send(ctx.companion, conversation.id, '我住在哪里？')).rejects.toMatchObject({ code: 'PROVIDER_NETWORK' })
      const afterFailure = ctx.companion.readConversation({ conversationId: conversation.id })
      expect(afterFailure.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
      expect(ctx.evaluations.at(-1)?.provider.outcome).toBe('failed')

      const next = await send(ctx.companion, conversation.id, '你好')
      expect(next.assistantMessage.body).toBe('好的。')
      expect(ctx.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    } finally {
      ctx.database.close()
    }
  })

  it('does not write a memory or a suggestion as a side effect of a retried turn', async () => {
    const ctx = setup([new Error('timeout'), reply('我这边没有保存你的车牌号，无法告诉你。')])
    try {
      const conversation = ctx.companion.createConversation()
      await send(ctx.companion, conversation.id, '我的车牌号是多少？')
      expect(ctx.memories.list()).toHaveLength(0)
      expect(ctx.companion.listMemorySuggestions({ conversationId: conversation.id })).toEqual([])
    } finally {
      ctx.database.close()
    }
  })
})

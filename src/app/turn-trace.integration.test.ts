import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../persistence/turn-state-repository'
import { EventLogService } from '../persistence/event-log'
import { PendingCognitionService } from '../cognition/pending-items'
import type { TurnStatePort } from '../cognition/turn-state-machine'
import { MemorySecretStore } from '../security/secrets'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import type { ProviderConsentPreview, ProviderPort } from '../providers/provider-policy'

const directories: string[] = []

function setup(states?: TurnStatePort, generateOverride?: ProviderPort['generate'], authorizeOverride?: (preview: ProviderConsentPreview) => Promise<{ providerId: string; payloadSha256: string; approvedAt: string; expiresAt: string; includeSensitive: boolean } | undefined>) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-trace-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  const generate = generateOverride ?? vi.fn(async () => ({ text: 'A deterministic trace reply.', modelId: DEEPSEEK_MODEL }))
  const provider: ProviderPort = {
    profile: { id: DEEPSEEK_PROVIDER_ID, providerClass: 'remote', configured: true },
    generate
  }
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: authorizeOverride ?? (async (preview: ProviderConsentPreview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    })),
    providerFactory: () => provider,
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database, new EventLogService(database))),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: states ?? new SqliteTurnStateRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'canary-key-not-a-real-secret-7f21' })
  const conversation = companion.createConversation()
  return { database, companion, conversation, generate }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('runtime turn trace', () => {
  it('records the real stage sequence with started, skipped and completed semantics', async () => {
    const context = setup()
    try {
      await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'TRACE-CANARY user text must never enter the trace',
        includeSensitive: false
      }, () => undefined)
      const trace = context.companion.getTurnTrace(context.conversation.id)
      expect(trace.map((event) => event.stage)).toEqual([
        'turn_received',
        'cognition_analysis',
        'context_built',
        'consent',
        'provider_request',
        'provider_delta',
        'persistence',
        'turn_completed'
      ])
      expect(trace.map((event) => event.status)).toEqual([
        'completed',
        'skipped',
        'completed',
        'completed',
        'started',
        'skipped',
        'completed',
        'completed'
      ])
      expect(trace[1]).toMatchObject({ stage: 'cognition_analysis', status: 'skipped', reason: 'analysis_unavailable' })
      expect(trace[5]).toMatchObject({ stage: 'provider_delta', status: 'skipped', reason: 'no_stream_delta' })
      expect(trace.every((event) => event.turnId === trace[0]!.turnId)).toBe(true)
      expect(trace.every((event) => event.conversationId === context.conversation.id)).toBe(true)
      const serialized = JSON.stringify(trace)
      expect(serialized).not.toContain('TRACE-CANARY')
      expect(serialized).not.toContain('canary-key-not-a-real-secret-7f21')
    } finally {
      context.database.close()
    }
  })

  it('records provider_delta as started and completed when the provider streams', async () => {
    const context = setup(undefined, async (_input, onDelta) => {
      onDelta?.('streamed ')
      onDelta?.('reply')
      return { text: 'streamed reply', modelId: DEEPSEEK_MODEL }
    })
    try {
      await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'Stream this answer.',
        includeSensitive: false
      }, () => undefined)
      const trace = context.companion.getTurnTrace(context.conversation.id)
      const deltas = trace.filter((event) => event.stage === 'provider_delta')
      expect(deltas.map((event) => event.status)).toEqual(['started', 'completed'])
      expect(deltas[0]!.durationMs).toBeNull()
      expect(deltas[1]!.durationMs).not.toBeNull()
    } finally {
      context.database.close()
    }
  })

  it('keeps the chat working and marks the trace incomplete when trace storage fails', async () => {
    const broken: TurnStatePort = {
      enter: () => undefined,
      get: () => null,
      listForConversation: () => [],
      appendTrace: () => { throw new Error('trace store unavailable') }
    }
    const context = setup(broken)
    try {
      const result = await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'The chat must still commit when the trace cannot be written.',
        includeSensitive: false
      }, () => undefined)
      expect(result.assistantMessage.body).toBe('A deterministic trace reply.')
      expect(context.conversation.id).toBeTruthy()
      const trace = context.companion.getTurnTrace(context.conversation.id)
      expect(trace).toHaveLength(1)
      expect(trace[0]).toMatchObject({
        stage: 'recovery',
        status: 'failed',
        moduleId: 'persistence/turn-trace',
        reason: 'TRACE_WRITE_FAILED'
      })
    } finally {
      context.database.close()
    }
  })

  it('settles a denied consent as failed instead of leaving a crash-shaped turn', async () => {
    const context = setup(undefined, undefined, async () => undefined)
    try {
      const requestId = randomUUID()
      await expect(context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId,
        content: 'This consent will be denied.',
        includeSensitive: false
      }, () => undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      const state = context.database.connection.prepare('SELECT state, reason FROM turn_states WHERE turn_id = ?').get(requestId) as { state: string; reason: string }
      expect(state).toEqual({ state: 'failed', reason: 'FORBIDDEN' })
      const trace = context.companion.getTurnTrace(context.conversation.id)
      expect(trace.at(-1)).toMatchObject({ stage: 'turn_failed', status: 'failed', reason: 'FORBIDDEN' })
      expect(context.companion.readConversation({ conversationId: context.conversation.id }).messages).toEqual([])
    } finally {
      context.database.close()
    }
  })

  it('retries a cancelled turn without duplicating the user message and settles it', async () => {
    let calls = 0
    const generate = vi.fn((input: { signal?: AbortSignal }) => {
      calls += 1
      if (calls === 1) {
        return new Promise<never>((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('aborted by test')))
        })
      }
      return Promise.resolve({ text: 'retry reply', modelId: DEEPSEEK_MODEL })
    })
    const context = setup(undefined, generate)
    try {
      const requestId = randomUUID()
      const first = context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId,
        content: 'Retry this turn after cancellation.',
        includeSensitive: false
      }, () => undefined)
      for (let index = 0; index < 40 && calls === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      expect(calls).toBe(1)
      expect(context.companion.cancelChat({ conversationId: context.conversation.id })).toBe(true)
      await expect(first).rejects.toBeDefined()
      const cancelled = context.database.connection.prepare('SELECT state FROM turn_states WHERE turn_id = ?').get(requestId) as { state: string }
      expect(cancelled.state).toBe('cancelled')

      await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId,
        content: 'Retry this turn after cancellation.',
        includeSensitive: false
      }, () => undefined)
      const conversation = context.companion.readConversation({ conversationId: context.conversation.id })
      expect(conversation.messages.filter((message) => message.role === 'user')).toHaveLength(1)
      expect(conversation.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
      const settled = context.database.connection.prepare('SELECT state FROM turn_states WHERE turn_id = ?').get(requestId) as { state: string }
      expect(settled.state).toBe('committed')
      const trace = context.companion.getTurnTrace(context.conversation.id)
      expect(trace.at(-1)).toMatchObject({ turnId: requestId, stage: 'turn_completed', status: 'completed' })
    } finally {
      context.database.close()
    }
  })

  it('deletes trace events with their conversation', async () => {
    const context = setup()
    try {
      await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'Delete this conversation after the turn.',
        includeSensitive: false
      }, () => undefined)
      expect(context.companion.getTurnTrace(context.conversation.id).length).toBeGreaterThan(0)
      context.companion.deleteConversation({ conversationId: context.conversation.id })
      expect(context.companion.getTurnTrace(context.conversation.id)).toEqual([])
      const row = context.database.connection.prepare('SELECT COUNT(*) AS count FROM turn_trace_events').get() as { count: number }
      expect(row.count).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('cascades trace deletion when the conversations table row is removed', () => {
    const context = setup()
    try {
      const conversation = context.companion.createConversation()
      const turnId = randomUUID()
      const chat = (context.companion as unknown as {
        chat: { recordTraceStage: (conversationId: string, turnId: string, stage: 'turn_received', status: 'completed', moduleId: string, reason: string | null, occurredAt: string) => void }
      }).chat
      chat.recordTraceStage(conversation.id, turnId, 'turn_received', 'completed', 'app/companion-service', null, new Date().toISOString())
      expect((context.database.connection.prepare('SELECT COUNT(*) AS count FROM turn_trace_events WHERE conversation_id = ?').get(conversation.id) as { count: number }).count).toBe(1)
      context.database.connection.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id)
      expect((context.database.connection.prepare('SELECT COUNT(*) AS count FROM turn_trace_events WHERE conversation_id = ?').get(conversation.id) as { count: number }).count).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('caps one turn at 200 persisted events even if a caller loops', () => {
    const context = setup()
    try {
      const turnId = randomUUID()
      const chat = (context.companion as unknown as {
        chat: { recordTraceStage: (conversationId: string, turnId: string, stage: 'provider_delta', status: 'completed', moduleId: string, reason: string | null, occurredAt: string) => void }
      }).chat
      for (let index = 0; index < 205; index += 1) {
        chat.recordTraceStage(context.conversation.id, turnId, 'provider_delta', 'completed', 'providers/openai-compatible', null, new Date(Date.now() + index).toISOString())
      }
      const row = context.database.connection.prepare('SELECT COUNT(*) AS count FROM turn_trace_events WHERE turn_id = ?').get(turnId) as { count: number }
      expect(row.count).toBe(200)
      expect(context.companion.getTurnTrace(context.conversation.id)).toHaveLength(200)
    } finally {
      context.database.close()
    }
  })
})

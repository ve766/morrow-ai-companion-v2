import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../shared/companion'
import { CompanionService } from '../../app/companion-service'
import { ConversationService } from '../../conversation/conversation-service'
import { MemoryService } from '../memory-service'
import { SqliteDatabase } from '../../persistence/database'
import { SqliteConversationRepository } from '../../persistence/conversation-repository'
import { SqliteMemoryRepository, type MemoryRepository } from '../../persistence/memory-repository'
import { EventLogService } from '../../persistence/event-log'
import { MemorySecretStore } from '../../security/secrets'
import type { ProviderConsent, ProviderConsentPreview } from '../../providers/provider-policy'
import { OpenAICompatibleProvider } from '../../providers/openai-compatible'
import type { MemoryRecord, MemoryRevisionRecord } from '../memory-domain'
import type { SupersededStatement } from './retrieval-supersession'

// Phase-B re-audit regressions.
//
// Two Phase-A defects are pinned here:
//  1. retrieval read a fresh clock inside `prepare`, so the consent preview and
//     the dispatched payload could be computed at different instants;
//  2. the cross-record correction chain was read through a silent truncation
//     window, so a weakened chain looked identical to "no corrections".

const directories: string[] = []
const databases: SqliteDatabase[] = []

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

// The clock in this suite advances one day per read, so consent windows are
// expressed against that same timeline rather than the real wall clock.
function approve(preview: ProviderConsentPreview): ProviderConsent {
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:04:00.000Z',
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('The global network path is forbidden in this test.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const database of databases.splice(0)) {
    try { database.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('retrieval is pinned to the turn instant', () => {
  it('uses one instant for the consent preview and the dispatched payload', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-instant-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)

    // Every clock read advances one millisecond, which is enough to make a
    // second, independent clock read observable while staying inside the
    // consent window. If retrieval read its own clock, the preview and the
    // dispatch would be pinned to different instants.
    let tick = 0
    const clock = (): string => new Date(Date.UTC(2026, 0, 1) + tick++).toISOString()

    const events = new EventLogService(database, clock)
    const memories = new MemoryService(new SqliteMemoryRepository(database), clock, () => randomUUID(), events)
    const conversations = new ConversationService(new SqliteConversationRepository(database), clock, () => randomUUID())
    const secrets = new MemorySecretStore()
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets,
      clock,
      authorize: async (preview) => approve(preview),
      providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, async () =>
        sseResponse([
          `data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: 'ok' } }] })}\n\n`,
          'data: [DONE]\n\n'
        ]))
    })

    try {
      companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-only-invalid-provider-key' })
      memories.create('I prefer green tea in the afternoon.', 'personal')
      memories.create('I drink coffee every morning.', 'personal')
      const conversationId = companion.createConversation().id

      await expect(companion.sendChat({
        conversationId,
        requestId: randomUUID(),
        content: 'Which tea do I prefer?',
        includeSensitive: false
      }, () => undefined)).resolves.toBeDefined()

      const decisions = events.list({ eventType: 'retrieval.decision', ascending: true })
      expect(decisions.length).toBeGreaterThanOrEqual(2)
      const instants = new Set(decisions.map((event) => String((event.payload as { evaluatedAt?: unknown }).evaluatedAt)))
      expect(instants.size).toBe(1)
      expect(decisions[0]?.payload).toMatchObject({ correctionChain: { truncated: false } })
    } finally {
      companion.shutdown()
      database.close()
      const index = databases.indexOf(database)
      if (index >= 0) databases.splice(index, 1)
    }
  })
})

describe('correction chain truncation is visible', () => {
  /** Delegates to the real repository but reports an exhausted correction window. */
  class TruncatingRepository implements MemoryRepository {
    constructor(private readonly inner: SqliteMemoryRepository, private readonly rows: number) {}
    create(record: MemoryRecord, revision: MemoryRevisionRecord): void { this.inner.create(record, revision) }
    get(id: string): MemoryRecord | null { return this.inner.get(id) }
    list(): MemoryRecord[] { return this.inner.list() }
    listActiveForContext(limit: number): MemoryRecord[] { return this.inner.listActiveForContext(limit) }
    countActive(): number { return this.inner.countActive() }
    countActiveForVerification(): number { return this.inner.countActiveForVerification() }
    search(query: string): MemoryRecord[] { return this.inner.search(query) }
    history(id: string): MemoryRevisionRecord[] | null { return this.inner.history(id) }
    transition(previousRevision: number, record: MemoryRecord, revision: MemoryRevisionRecord): void {
      this.inner.transition(previousRevision, record, revision)
    }
    delete(id: string): boolean { return this.inner.delete(id) }
    listSupersededStatements(): SupersededStatement[] {
      return Array.from({ length: this.rows }, (_, index) => ({
        memoryId: `memory-${index}`,
        revision: 1,
        text: `superseded statement ${index}`,
        supersededAt: '2026-01-01T00:00:00.000Z',
        supersedingConfirmedAt: '2026-01-01T00:00:00.000Z'
      }))
    }
  }

  it('flags the decision when the correction window is exhausted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-chain-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)

    // 2001 rows = cap (2000) + 1, which is how truncation is detected.
    const memories = new MemoryService(new TruncatingRepository(new SqliteMemoryRepository(database), 2001), () => '2026-10-25T00:00:00.000Z')
    memories.create('I prefer green tea in the afternoon.', 'personal')

    const decision = memories.retrieveWithDecision('green tea', 'personal', { now: '2026-10-25T00:00:00.000Z' }).decision
    expect(decision.correctionChain).toEqual({ statements: 2000, truncated: true })
  })

  it('does not flag a complete correction window', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-chain-ok-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)

    const memories = new MemoryService(new TruncatingRepository(new SqliteMemoryRepository(database), 3), () => '2026-10-25T00:00:00.000Z')
    memories.create('I prefer green tea in the afternoon.', 'personal')

    const decision = memories.retrieveWithDecision('green tea', 'personal', { now: '2026-10-25T00:00:00.000Z' }).decision
    expect(decision.correctionChain).toEqual({ statements: 3, truncated: false })
  })
})

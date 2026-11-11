/**
 * Observed turn-state sequence (B4).
 *
 * `turn_states` keeps one row per turn, so the stored value only ever shows the
 * latest state. The sequence is what the checklist asks for, so this test wraps
 * the real port with a recorder: every `enter` call is captured and forwarded to
 * SQLite. Nothing inside the service is patched.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from '../memory/memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { CompanionService } from './companion-service'
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../persistence/turn-state-repository'
import { InterestService, SqliteInterestRepository } from '../self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../self-model/reflection-service'
import { EventLogService } from '../persistence/event-log'
import { PendingCognitionService } from '../cognition/pending-items'
import { canTransition, type TurnState, type TurnStatePort, type TurnStateRecord } from '../cognition/turn-state-machine'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../providers/provider-policy'

class FlakyProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  failure: string | null = null
  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    if (this.failure) throw new Error(this.failure)
    return { text: '好的。', modelId: 'stub', attempts: 1 }
  }
}

/** Records every lifecycle step, then delegates to the real store. */
class RecordingStatePort implements TurnStatePort {
  readonly seen: TurnState[] = []
  constructor(private readonly inner: TurnStatePort) {}
  enter(record: TurnStateRecord): void {
    this.seen.push(record.state)
    this.inner.enter(record)
  }
  get(turnId: string): TurnStateRecord | null {
    return this.inner.get(turnId)
  }
}

const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close()
    } catch {
      continue
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function buildStack() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-turn-state-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const states = new RecordingStatePort(new SqliteTurnStateRepository(database))
  const provider = new FlakyProvider()
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => ({
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }),
    providerFactory: () => provider,
    selfModelLoop: { events, interests, selfModel, reflection },
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database, events)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
  companion.saveCognitiveSettings({ enabled: true })
  return { companion, provider, states }
}

describe('turn state sequence', () => {
  it('walks received → analyzed → context_ready → awaiting_consent → requesting → response_received → committed', async () => {
    const { companion, states } = buildStack()
    const conversation = companion.createConversation()
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '你好。', includeSensitive: false }, () => undefined)

    expect(states.seen).toEqual(['received', 'analyzed', 'context_ready', 'awaiting_consent', 'requesting', 'response_received', 'committed'])
    // Every recorded step must also be a legal transition, otherwise the trace
    // would be showing moves the state machine forbids.
    for (let index = 1; index < states.seen.length; index += 1) {
      expect(canTransition(states.seen[index - 1]!, states.seen[index]!)).toBe(true)
    }
  })

  it('records a provider failure after requesting, and never claims a delivery', async () => {
    const { companion, provider, states } = buildStack()
    const conversation = companion.createConversation()
    provider.failure = 'scripted provider failure'
    await expect(companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '你好。', includeSensitive: false }, () => undefined))
      .rejects.toThrow()

    expect(states.seen.at(-1)).toBe('failed')
    expect(states.seen).toContain('requesting')
    expect(states.seen).not.toContain('response_received')
    expect(states.seen).not.toContain('committed')
  })

  it('declares the interrupted-only states legal from the steps that can reach them', () => {
    // A turn can be interrupted at any non-terminal step, so `recovery_required`
    // is reachable from every one of them — and from none of the terminal ones,
    // because recovery must never revive a finished turn.
    for (const state of ['received', 'analyzed', 'context_ready', 'awaiting_consent', 'requesting', 'response_received'] as const) {
      expect(canTransition(state, 'recovery_required')).toBe(true)
    }
    for (const state of ['committed', 'failed', 'cancelled'] as const) {
      expect(canTransition(state, 'recovery_required')).toBe(false)
      expect(canTransition(state, 'recovering')).toBe(false)
    }
    expect(canTransition('recovery_required', 'recovering')).toBe(true)
    expect(canTransition('recovering', 'committed')).toBe(true)
    expect(canTransition('recovering', 'failed')).toBe(true)
    expect(canTransition('awaiting_consent', 'requesting')).toBe(true)
  })
})

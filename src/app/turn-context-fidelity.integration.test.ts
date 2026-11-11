/**
 * Fidelity of the persisted turn context.
 *
 * The turn context is the audit record of what a turn actually did: which
 * reference it depended on, and whether an interaction-state event landed. Both
 * were being written incorrectly and silently:
 *
 *   - `contextDependency` did not exist, so a turn that depended on the previous
 *     one was indistinguishable from a self-contained question;
 *   - `feeling.applied` was always false for a successful turn, because the
 *     finalization patch ran inside the message transaction and its state read
 *     opened a nested transaction that failed and fell back to a default.
 *
 * These assertions are on the stored record, not on in-memory values.
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
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../providers/provider-policy'

class StubProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    return { text: '好的。', modelId: 'stub', attempts: 1 }
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

function buildStack(): CompanionService {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-turn-context-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const provider = new StubProvider()
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
      states: new SqliteTurnStateRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
  companion.saveCognitiveSettings({ enabled: true })
  return companion
}

describe('persisted turn context', () => {
  it('records whether the turn depended on the previous one', async () => {
    const companion = buildStack()
    const conversation = companion.createConversation()

    // Nothing to resolve against: the first turn of a conversation must say so
    // instead of guessing a topic.
    const orphan = randomUUID()
    await companion.sendChat({ conversationId: conversation.id, requestId: orphan, content: '它是什么时候的事？', includeSensitive: false }, () => undefined)
    expect(companion.readTurnContext({ turnId: orphan })?.intent.contextDependency).toBe('unresolved')

    const standalone = randomUUID()
    await companion.sendChat({ conversationId: conversation.id, requestId: standalone, content: '天文学史里最难的是什么？', includeSensitive: false }, () => undefined)
    expect(companion.readTurnContext({ turnId: standalone })?.intent.contextDependency).toBe('none')

    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我最近在读天文学史。', includeSensitive: false }, () => undefined)
    const follow = randomUUID()
    await companion.sendChat({ conversationId: conversation.id, requestId: follow, content: '它最难的部分是什么？', includeSensitive: false }, () => undefined)
    expect(companion.readTurnContext({ turnId: follow })?.intent.contextDependency).toBe('prior_turn')
  })

  it('records the committed state when a state event lands', async () => {
    const companion = buildStack()
    const conversation = companion.createConversation()
    const turnId = randomUUID()
    // Explicit positive feedback is what produces a state event.
    await companion.sendChat({ conversationId: conversation.id, requestId: turnId, content: '这个回答很有帮助。', includeSensitive: false }, () => undefined)

    const context = companion.readTurnContext({ turnId })
    const committed = companion.getFeelingState().state
    expect(context?.feeling.eventType).toBe('positive_feedback')
    expect(context?.feeling.applied).toBe(true)
    // `after` must describe the state that is actually stored, not the
    // pre-commit projection (which carried the previous revision).
    expect(context?.feeling.after?.revision).toBe(committed.revision)
    expect(context?.feeling.after?.valence).toBe(committed.values.valence)
  })

  it('does not claim a state change when no event was detected', async () => {
    const companion = buildStack()
    const conversation = companion.createConversation()
    const turnId = randomUUID()
    await companion.sendChat({ conversationId: conversation.id, requestId: turnId, content: '天文学史里最难的是什么？', includeSensitive: false }, () => undefined)
    const context = companion.readTurnContext({ turnId })
    expect(context?.feeling.eventType).toBeNull()
    expect(context?.feeling.applied).toBe(false)
    expect(companion.getFeelingState().state.revision).toBe(0)
  })
})

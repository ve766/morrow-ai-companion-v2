/**
 * B4 — the interrupted-turn recovery loop, with faults injected.
 *
 * The state table and the persisted intent existed before; what was missing was
 * evidence that a *real* interruption is repaired without duplicating anything.
 * These tests break the commit in two places and check the database afterwards,
 * not just a return value:
 *
 *   1. the assistant message never lands (process died between intent and commit)
 *      → the turn is repaired as `failed`, the provider is **not** called again,
 *        and a second recovery does nothing;
 *   2. the message lands but the intent is not cleared (died after commit)
 *      → the turn is completed from its intent, with no second assistant message;
 *   3. the conversation is deleted before recovery
 *      → nothing is resurrected.
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
import type { TurnFinalizationPort, TurnFinalizationRecord } from '../persistence/cognitive-context-repository'

class CountingProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    return { text: '好的。', modelId: 'stub', attempts: 1 }
  }
}

/** Throws on the first assistant append, so the intent survives without a message. */
class BreakingConversations extends ConversationService {
  failNextAssistantAppend = false
  override appendMessage(...args: Parameters<ConversationService['appendMessage']>) {
    const [, role] = args
    if (role === 'assistant' && this.failNextAssistantAppend) {
      this.failNextAssistantAppend = false
      throw new Error('injected commit failure')
    }
    return super.appendMessage(...args)
  }
}

/** Leaves the intent behind once, so the delivered-but-unsettled path is reached. */
class LeakyFinalizations implements TurnFinalizationPort {
  leaveOneIntent = false
  constructor(private readonly inner: SqliteTurnFinalizationRepository) {}
  put(record: TurnFinalizationRecord): void { this.inner.put(record) }
  list(limit?: number): TurnFinalizationRecord[] { return this.inner.list(limit ?? 50) }
  get(turnId: string): TurnFinalizationRecord | null { return this.inner.get(turnId) }
  remove(turnId: string): void {
    if (this.leaveOneIntent) {
      this.leaveOneIntent = false
      return
    }
    this.inner.remove(turnId)
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

function buildStack(options: { database?: SqliteDatabase; conversations?: ConversationService } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-b4-recovery-'))
  directories.push(directory)
  const database = options.database ?? SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = options.conversations ?? new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const finalizations = new LeakyFinalizations(new SqliteTurnFinalizationRepository(database))
  const provider = new CountingProvider()
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
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations,
      states: new SqliteTurnStateRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
  companion.saveCognitiveSettings({ enabled: true })
  return { companion, provider, conversations, finalizations, database }
}

describe('B4 recovery loop', () => {
  it('repairs a turn whose assistant message never landed, without calling the provider again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-b4-a-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const breaking = new BreakingConversations(new SqliteConversationRepository(database))
    const stack = buildStack({ database, conversations: breaking })
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()

    breaking.failNextAssistantAppend = true
    await expect(stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '你好。', includeSensitive: false }, () => undefined))
      .rejects.toThrow()

    // Positive control: the user message is there, the answer is not.
    const before = stack.companion.readConversation({ conversationId: conversation.id })
    expect(before.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(before.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    const providerCallsBefore = stack.provider.calls

    const first = stack.companion.recoverInterruptedTurns()
    expect(first.interrupted).toBe(1)
    expect(stack.provider.calls).toBe(providerCallsBefore)

    // No duplicate user message, still no assistant message, turn recorded failed.
    const after = stack.companion.readConversation({ conversationId: conversation.id })
    expect(after.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(after.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    expect(stack.companion.readTurnContext({ turnId: requestId })!.status).toBe('failed')

    // Recovery is idempotent: the intent is gone, so a second pass does nothing.
    const second = stack.companion.recoverInterruptedTurns()
    expect(second.completed + second.interrupted).toBe(0)
    expect(stack.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'user')).toHaveLength(1)
  })

  it('completes a turn whose message landed but whose intent was left behind, with no second answer', async () => {
    const stack = buildStack()
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()

    stack.finalizations.leaveOneIntent = true
    await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '你好。', includeSensitive: false }, () => undefined)
    // The turn finished, but the intent was not cleared — the "died after commit" shape.
    expect(stack.finalizations.get(requestId)).not.toBeNull()

    const result = stack.companion.recoverInterruptedTurns()
    expect(result.completed).toBe(1)
    const messages = stack.companion.readConversation({ conversationId: conversation.id }).messages
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(stack.provider.calls).toBe(1)
  })

  it('does not resurrect a conversation that was deleted before recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-b4-c-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const breaking = new BreakingConversations(new SqliteConversationRepository(database))
    const stack = buildStack({ database, conversations: breaking })
    const conversation = stack.companion.createConversation()

    breaking.failNextAssistantAppend = true
    await expect(stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '你好。', includeSensitive: false }, () => undefined))
      .rejects.toThrow()

    stack.companion.deleteConversation({ conversationId: conversation.id })
    const result = stack.companion.recoverInterruptedTurns()
    // Either dropped (kept for a later attempt) or nothing to do — never a
    // resurrected conversation.
    expect(result.completed).toBe(0)
    expect(() => stack.companion.readConversation({ conversationId: conversation.id })).toThrow()
  })

  it('survives a restart between the interruption and the recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-b4-d-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const first = SqliteDatabase.open(path)
    const breaking = new BreakingConversations(new SqliteConversationRepository(first))
    const stack = buildStack({ database: first, conversations: breaking })
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()
    breaking.failNextAssistantAppend = true
    await expect(stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '你好。', includeSensitive: false }, () => undefined))
      .rejects.toThrow()
    first.close()

    const reopened = SqliteDatabase.open(path)
    databases.push(reopened)
    const restarted = buildStack({ database: reopened })
    const result = restarted.companion.recoverInterruptedTurns()
    expect(result.interrupted).toBe(1)
    const messages = restarted.companion.readConversation({ conversationId: conversation.id }).messages
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
  })
})

/**
 * B1 at the payload level.
 *
 * The unit tests prove the score moves; this proves the *request* changes. The
 * strategy is serialized into the system message (`response route=…`) and a
 * `clarify` route adds an explicit instruction, so a strategy change is visible to
 * the model — which is the only thing "influences the decision" can mean here.
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

class CapturingProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  payloads: string[] = []
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.payloads.push(JSON.stringify(input.requestPayload).replace(/\\"/gu, '"'))
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

function buildStack() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-b1-payload-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
  const reflection = new ReflectionService(new SqliteReflectionRepository(database), { memories, interests, selfModel, events }, events)
  const provider = new CapturingProvider()
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
  return { companion, provider }
}

describe('B1 strategy reaches the serialized request', () => {
  it('asks for one clarifying question when the reference cannot be resolved', async () => {
    const { companion, provider } = buildStack()
    const conversation = companion.createConversation()
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '那个怎么办？', includeSensitive: false }, () => undefined)
    const payload = provider.payloads[0]!
    expect(payload).toContain('response route=clarify')
    expect(payload).toContain('Ask one concise clarifying question')
  })

  it('answers instead of asking once the same turn has resolvable context', async () => {
    const { companion, provider } = buildStack()
    const conversation = companion.createConversation()
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我的租房合同下周到期。', includeSensitive: false }, () => undefined)
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '那个怎么办？', includeSensitive: false }, () => undefined)
    const payload = provider.payloads[1]!
    expect(payload).not.toContain('response route=clarify')
    expect(payload).not.toContain('Ask one concise clarifying question')
  })

  it('routes a clear personal question to memory regardless of unrelated history', async () => {
    const { companion, provider } = buildStack()
    const conversation = companion.createConversation()
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '今天股市怎么样？', includeSensitive: false }, () => undefined)
    await companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我住在哪里？', includeSensitive: false }, () => undefined)
    const withHistory = provider.payloads[1]!

    const second = buildStack()
    const otherConversation = second.companion.createConversation()
    await second.companion.sendChat({ conversationId: otherConversation.id, requestId: randomUUID(), content: '我住在哪里？', includeSensitive: false }, () => undefined)
    const withoutHistory = second.provider.payloads[0]!

    // Same route either way: history presence is not worth a route change.
    expect(withHistory).toContain('response route=retrieve_memory')
    expect(withoutHistory).toContain('response route=retrieve_memory')
  })
})

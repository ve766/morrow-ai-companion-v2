/**
 * Payload-level check for interest invalidation.
 *
 * The service-level tests prove the ledger and the status are repaired. That is
 * not the same as proving the *request* stops carrying the interest: the block is
 * assembled from `activeForContext()` and serialized into the provider payload,
 * and a stale row there would still reach the model. These tests read the payload
 * that would have been sent.
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
  lastPayload = ''
  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.lastPayload = JSON.stringify(input.requestPayload).replace(/\\"/gu, '"')
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
  const directory = mkdtempSync(join(tmpdir(), 'morrow-interest-payload-'))
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
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
  companion.saveCognitiveSettings({ enabled: true })
  return { companion, memories, interests, provider }
}

async function sendTurn(companion: CompanionService, conversationId: string): Promise<string> {
  await companion.sendChat({ conversationId, requestId: randomUUID(), content: '继续。', includeSensitive: false }, () => undefined)
  return 'sent'
}

describe('an invalidated interest stops reaching the request payload', () => {
  it('drops the interest from the payload when its memory evidence is retracted', async () => {
    const { companion, memories, interests, provider } = buildStack()
    const first = companion.createConversation()
    const second = companion.createConversation()
    const memoryA = memories.create('我在学咖啡拉花。')
    const memoryB = memories.create('最近一直在练咖啡拉花。')
    interests.observe({ conversationId: first.id, messageId: memoryA.id, evidenceKind: 'memory', evidenceRevision: memoryA.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memoryA.currentText })
    interests.observe({ conversationId: second.id, messageId: memoryB.id, evidenceKind: 'memory', evidenceRevision: memoryB.revision, occurredAt: '2026-10-21T10:00:00.000Z', topicText: memoryB.currentText })
    const messageId = randomUUID()
    await companion.sendChat({ conversationId: second.id, requestId: messageId, content: '今天又练了咖啡拉花。', includeSensitive: false }, () => undefined)
    const target = interests.list()[0]!
    expect(target.status).toBe('active')

    // Positive control: the block and this exact id are in the serialized request.
    await sendTurn(companion, second.id)
    expect(provider.lastPayload).toContain('Topics the user returned to across conversations')
    expect(provider.lastPayload).toContain(target.id)

    memories.retract(memoryA.id)
    memories.retract(memoryB.id)

    await sendTurn(companion, second.id)
    expect(provider.lastPayload).not.toContain(target.id)
    expect(provider.lastPayload).not.toContain('咖啡拉花（id')
    expect(interests.activeForContext()).toHaveLength(0)
  })

  it('drops the interest from the payload when the user reverses, and restores it on a newer support', async () => {
    const { companion, interests, provider } = buildStack()
    const first = companion.createConversation()
    const second = companion.createConversation()
    const third = companion.createConversation()
    interests.observe({ conversationId: first.id, messageId: randomUUID(), occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
    interests.observe({ conversationId: second.id, messageId: randomUUID(), occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
    interests.observe({ conversationId: second.id, messageId: randomUUID(), occurredAt: '2026-10-21T10:05:00.000Z', topicText: '今天又练了咖啡拉花' })
    const target = interests.list()[0]!
    expect(target.status).toBe('active')

    await sendTurn(companion, second.id)
    expect(provider.lastPayload).toContain(target.id)

    interests.observe({ conversationId: third.id, messageId: randomUUID(), occurredAt: '2026-10-22T10:00:00.000Z', topicText: '我不想再练咖啡拉花了' })
    await sendTurn(companion, second.id)
    expect(provider.lastPayload).not.toContain(target.id)

    // "重新喜欢" is a newer support: it clears the reversal rather than being
    // vetoed by it, so the interest can come back into the payload.
    interests.observe({ conversationId: third.id, messageId: randomUUID(), occurredAt: '2026-10-25T10:00:00.000Z', topicText: '我又开始练咖啡拉花了' })
    await sendTurn(companion, second.id)
    expect(provider.lastPayload).toContain(target.id)
  })
})

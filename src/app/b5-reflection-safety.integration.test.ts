/**
 * B5 safety boundary: reflection is an adjunct, never a dependency.
 *
 * A reflection run can fail for ordinary reasons (rate limit, storage, a bug in a
 * finding rule). If that failure could reach the chat path, a background
 * maintenance job would decide whether the user gets an answer — which is exactly
 * backwards. This test makes reflection throw and checks the turn still lands.
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

describe('B5 reflection cannot block a turn', () => {
  it('delivers the answer even when reflection throws', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-b5-safety-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const events = new EventLogService(database)
    const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const interests = new InterestService(new SqliteInterestRepository(database), events)
    const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
    let reflectionCalls = 0
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
      providerFactory: () => new StubProvider(),
      selfModelLoop: {
        events,
        interests,
        selfModel,
        reflection: {
          run: () => {
            reflectionCalls += 1
            throw new Error('injected reflection failure')
          }
        }
      },
      continuity: {
        contexts: new SqliteTurnContextRepository(database),
        pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
        finalizations: new SqliteTurnFinalizationRepository(database),
        states: new SqliteTurnStateRepository(database)
      }
    })
    companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-key' })
    companion.saveCognitiveSettings({ enabled: true })

    const conversation = companion.createConversation()
    const requestId = randomUUID()
    await expect(companion.sendChat({ conversationId: conversation.id, requestId, content: '你好。', includeSensitive: false }, () => undefined))
      .resolves.toBeDefined()

    const messages = companion.readConversation({ conversationId: conversation.id }).messages
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    // The failure was actually exercised — otherwise this test proves nothing.
    expect(reflectionCalls).toBeGreaterThan(0)
  })
})

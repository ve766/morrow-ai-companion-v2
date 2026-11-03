/**
 * A real companion stack for tests that need the actual chat path.
 *
 * Nothing here is stubbed except the provider (which must be, or a test would
 * call a paid API) and the consent callback. Every repository, migration,
 * service and the composition itself are the production ones, so a test can
 * assert on committed rows and serialized payloads rather than on mocks.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteDatabase } from '../../src/persistence/database'
import { MemoryService } from '../../src/memory/memory-service'
import { MemoryImportanceService } from '../../src/memory/memory-importance'
import { SqliteMemoryRepository } from '../../src/persistence/memory-repository'
import { ConversationService } from '../../src/conversation/conversation-service'
import { SqliteConversationRepository } from '../../src/persistence/conversation-repository'
import { CompanionService } from '../../src/app/companion-service'
import {
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository,
  SqlitePendingItemRepository
} from '../../src/persistence/cognitive-context-repository'
import { SqliteTurnStateRepository } from '../../src/persistence/turn-state-repository'
import { IntentReadingRepository } from '../../src/persistence/intent-reading-repository'
import { InterestService, SqliteInterestRepository } from '../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../src/self-model/self-model-service'
import { ReflectionService, SqliteReflectionRepository } from '../../src/self-model/reflection-service'
import { EventLogService } from '../../src/persistence/event-log'
import { PendingCognitionService } from '../../src/cognition/pending-items'
import { PersonalizationService } from '../../src/personalization/personalization-service'
import { PersonalityGrowthService } from '../../src/personalization/personality-growth'
import { UserInteractionProfileService } from '../../src/personalization/interaction-profile'
import { CompanionGoalService } from '../../src/motivation/companion-goal'
import { ExplorationService } from '../../src/self-model/exploration-policy'
import { PersonalityService } from '../../src/app/companion-service'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../src/shared/companion'
import { MemorySecretStore } from '../../src/security/secrets'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../../src/providers/provider-policy'

export class TestProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  lastPayload = ''
  reply = '好的。'
  failure: string | null = null

  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    this.lastPayload = JSON.stringify(input.requestPayload)
    if (this.failure) throw new Error(this.failure)
    return { text: this.reply, modelId: 'test-provider', attempts: 1 }
  }
}

export interface Stack {
  companion: CompanionService
  database: SqliteDatabase
  readings: IntentReadingRepository
  events: EventLogService
  memories: MemoryService
  interests: InterestService
  reflection: ReflectionService
  goals: CompanionGoalService
  provider: TestProvider
  close(): void
}

export interface StackOptions {
  /** Replace the journal with one that can be made to fail (P0-4 tests). */
  eventLog?: (database: SqliteDatabase) => EventLogService
  reflectionRepository?: (database: SqliteDatabase) => SqliteReflectionRepository
  clock?: () => string
  databasePath?: string
  keepDatabase?: boolean
}

export function buildTestStack(options: StackOptions = {}): Stack {
  const directory = options.databasePath ? null : mkdtempSync(join(tmpdir(), 'morrow-test-'))
  const path = options.databasePath ?? join(directory!, 'morrow.sqlite3')
  const database = SqliteDatabase.open(path)
  const clock = options.clock
  const events = options.eventLog ? options.eventLog(database) : new EventLogService(database, clock)
  const importance = new MemoryImportanceService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events, { importance })
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const provider = new TestProvider()
  const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
  const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events, clock)
  const reflectionRepository = options.reflectionRepository
    ? options.reflectionRepository(database)
    : new SqliteReflectionRepository(database)
  const reflection = new ReflectionService(reflectionRepository, { memories, interests, selfModel, events }, events, clock)
  const personalization = new PersonalizationService(database, clock)
  const growth = new PersonalityGrowthService(database, clock)
  const interaction = new UserInteractionProfileService(
    database,
    () => {
      const profile = new PersonalityService(database, clock).get()
      return { warmth: profile.warmth, directness: profile.directness, humor: profile.humor }
    },
    clock
  )
  const exploration = new ExplorationService(database, clock)
  const goals = new CompanionGoalService(database, events, clock)

  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    authorize: async (preview) => {
      const nowMs = Date.parse(clock ? clock() : new Date().toISOString())
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
    providerFactory: () => provider,
    selfModelLoop: {
      events,
      interests,
      selfModel,
      reflection,
      personalization,
      growth,
      interaction,
      exploration,
      goals,
      memories
    },
    ...(clock ? { clock } : {}),
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database),
      states: new SqliteTurnStateRepository(database),
      readings: new IntentReadingRepository(database, clock)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
  companion.saveCognitiveSettings({ enabled: true })

  return {
    companion,
    database,
    readings: new IntentReadingRepository(database, clock),
    events,
    memories,
    interests,
    reflection,
    goals,
    provider,
    close: () => {
      database.close()
      if (directory && !options.keepDatabase) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

export function systemText(payload: string): string {
  const parsed = JSON.parse(payload) as { messages?: Array<{ role: string; content: string }> }
  return parsed.messages?.find((message) => message.role === 'system')?.content ?? ''
}

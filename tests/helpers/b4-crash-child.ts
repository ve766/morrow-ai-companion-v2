/**
 * Child process for the B4 crash tests.
 *
 * It runs one real turn against a real SQLite file and kills itself with SIGKILL
 * at a chosen lifecycle stage, after writing a barrier file the parent waits on.
 * Nothing here mocks the crash: the process really dies mid-turn, and the parent
 * reopens the database the way a restart would.
 *
 * Injection is done entirely from this file's own wiring (the provider, the
 * consent callback, the conversation and finalization wrappers). No production
 * code contains a "test crash" branch.
 *
 * Env:
 *   MORROW_CRASH_DB       database path
 *   MORROW_CRASH_STAGE    before-provider | during-provider |
 *                         after-provider-before-persist | after-commit-before-cleanup
 *   MORROW_CRASH_BARRIER  file to write before dying
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CompanionService } from '../../src/app/companion-service'
import { ConversationService } from '../../src/conversation/conversation-service'
import { MemoryService } from '../../src/memory/memory-service'
import { SqliteDatabase } from '../../src/persistence/database'
import { SqliteConversationRepository } from '../../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../../src/persistence/memory-repository'
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../../src/persistence/cognitive-context-repository'
import { PendingCognitionService } from '../../src/cognition/pending-items'
import { SqliteTurnStateRepository } from '../../src/persistence/turn-state-repository'
import { MemorySecretStore } from '../../src/security/secrets'
import { EventLogService } from '../../src/persistence/event-log'
import { InterestService, SqliteInterestRepository } from '../../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../../src/self-model/self-model-service'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../src/shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../../src/providers/provider-policy'

const databasePath = process.env.MORROW_CRASH_DB ?? ''
const stage = process.env.MORROW_CRASH_STAGE ?? ''
const barrier = process.env.MORROW_CRASH_BARRIER ?? ''
if (!databasePath || !stage || !barrier) throw new Error('missing env')

let providerCalls = 0
function mark(payload: Record<string, unknown> = {}): void {
  mkdirSync(dirname(barrier), { recursive: true })
  writeFileSync(barrier, JSON.stringify({ stage, providerCalls, ...payload }), 'utf8')
}

function die(payload: Record<string, unknown> = {}): never {
  mark(payload)
  // SIGKILL: no finally blocks, no flush — the closest thing to a power cut.
  process.kill(process.pid, 'SIGKILL')
  throw new Error('unreachable')
}

class CrashProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    providerCalls += 1
    if (stage === 'during-provider') die()
    return { text: '好的。', modelId: 'stub', attempts: 1 }
  }
}

class CrashConversations extends ConversationService {
  override appendMessage(...args: Parameters<ConversationService['appendMessage']>) {
    const [, role] = args
    if (stage === 'after-provider-before-persist' && role === 'assistant') die()
    return super.appendMessage(...args)
  }
}

class CrashFinalizations extends SqliteTurnFinalizationRepository {
  override remove(turnId: string): void {
    // Commit and cleanup happen in one transaction, so a *crash* cannot leave the
    // "committed but intent not cleared" window: the rollback takes the message
    // with it. That window is only reachable when the cleanup itself fails, which
    // the service deliberately swallows (`complete = false`). So this stage
    // injects a cleanup failure and lets the process finish normally.
    if (stage === 'cleanup-failure') {
      mark()
      throw new Error('injected cleanup failure')
    }
    super.remove(turnId)
  }
}

const database = SqliteDatabase.open(databasePath)
const events = new EventLogService(database)
const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
const conversations = new CrashConversations(new SqliteConversationRepository(database))
const interests = new InterestService(new SqliteInterestRepository(database), events)
const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
const companion = new CompanionService({
  database,
  memories,
  conversations,
  secrets: new MemorySecretStore(),
  authorize: async (preview) => {
    if (stage === 'before-provider') die()
    return {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }
  },
  providerFactory: () => new CrashProvider(),
  selfModelLoop: { events, interests, selfModel },
  continuity: {
    contexts: new SqliteTurnContextRepository(database),
    pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
    finalizations: new CrashFinalizations(database),
    states: new SqliteTurnStateRepository(database)
  }
})
companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
companion.saveCognitiveSettings({ enabled: true })

const conversation = companion.createConversation()
mkdirSync(dirname(barrier), { recursive: true })
writeFileSync(`${barrier}.conv`, conversation.id, 'utf8')

// The turn itself. Each stage kills the process somewhere inside this call.
void companion.sendChat(
  { conversationId: conversation.id, requestId: process.env.MORROW_CRASH_TURN!, content: '你好。', includeSensitive: false },
  () => undefined
)

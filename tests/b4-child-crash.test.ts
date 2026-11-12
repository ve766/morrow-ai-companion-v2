/**
 * B4 — process-level crash tests.
 *
 * The integration tests in `src/app/b4-recovery.integration.test.ts` inject a
 * `throw`. A throw is not a crash: `finally` blocks run, the connection closes
 * politely, and in-flight writes may still be flushed. These tests kill a real
 * child process with SIGKILL at four lifecycle stages and let the parent reopen
 * the database, exactly like a restart would.
 *
 * What each stage proves:
 *   before-provider            nothing was sent, so nothing may be invented;
 *   during-provider            a request may be in flight upstream, so recovery
 *                              must not re-send it and must settle the turn;
 *   after-provider-before-persist  an intent exists but no answer does → failed,
 *                              and the provider is not called again;
 *   after-commit-before-cleanup    the answer landed, only the intent is stale →
 *                              completed, with no second assistant message.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/persistence/database'
import { CompanionService } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../src/persistence/cognitive-context-repository'
import { PendingCognitionService } from '../src/cognition/pending-items'
import { SqliteTurnStateRepository } from '../src/persistence/turn-state-repository'
import { MemorySecretStore } from '../src/security/secrets'
import { EventLogService } from '../src/persistence/event-log'
import { InterestService, SqliteInterestRepository } from '../src/self-model/interest-service'
import { SelfModelService, SqliteSelfModelRepository } from '../src/self-model/self-model-service'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../src/providers/provider-policy'

const CHILD_BUNDLE = join(process.cwd(), 'node_modules', '.cache', 'b4-crash-child.cjs')
const directories: string[] = []

beforeAll(() => {
  // The child imports the app's TypeScript directly, so it is bundled once here
  // rather than committed as generated code.
  execFileSync('node', [
    'node_modules/esbuild/bin/esbuild',
    'tests/helpers/b4-crash-child.ts',
    '--bundle', '--platform=node', '--format=cjs', '--external:electron',
    `--outfile=${CHILD_BUNDLE}`, '--log-level=warning'
  ], { cwd: process.cwd(), stdio: 'pipe', timeout: 120_000 })
}, 180_000)

afterAll(() => {
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows keeps handles briefly; a leftover temp dir is not a test failure.
    }
  }
})

class StubProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  async generate(_input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    return { text: '恢复后的回答。', modelId: 'stub', attempts: 1 }
  }
}

interface CrashOutcome {
  databasePath: string
  conversationId: string
  turnId: string
  barrier: { stage: string; providerCalls: number }
}

async function crashAt(stage: string): Promise<CrashOutcome> {
  const directory = mkdtempSync(join(tmpdir(), `morrow-b4-crash-${stage}-`))
  directories.push(directory)
  const databasePath = join(directory, 'morrow.sqlite3')
  const barrierPath = join(directory, 'barrier.json')
  const turnId = randomUUID()
  const child = spawn(process.execPath, [CHILD_BUNDLE], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MORROW_CRASH_DB: databasePath,
      MORROW_CRASH_STAGE: stage,
      MORROW_CRASH_BARRIER: barrierPath,
      MORROW_CRASH_TURN: turnId
    },
    stdio: 'pipe'
  })

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }))
  })
  // Wait for the barrier, then for the process to actually die.
  const deadline = Date.now() + 60_000
  while (!existsSync(barrierPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!existsSync(barrierPath)) {
    child.kill('SIGKILL')
    throw new Error(`child never reached stage ${stage}`)
  }
  const exit = await exited
  // The child must die *without* finishing: either killed by the signal (POSIX)
  // or terminated by it with a non-zero code (Windows has no POSIX signals, so
  // `process.kill(pid, 'SIGKILL')` reports exit code 1 and signal null). A clean
  // exit 0 would mean the crash never happened where it was supposed to.
  // The cleanup-failure stage is not a crash: it lets the turn finish so the
  // message commits and only the intent is left behind.
  if (stage !== 'cleanup-failure') {
    const diedAbruptly = exit.signal === 'SIGKILL' || exit.code === null ||
      (process.platform === 'win32' && exit.code !== 0)
    expect(diedAbruptly).toBe(true)
  }

  const conversationId = readFileSync(`${barrierPath}.conv`, 'utf8')
  const barrier = JSON.parse(readFileSync(barrierPath, 'utf8')) as { stage: string; providerCalls: number }
  return { databasePath, conversationId, turnId, barrier }
}

/** Reopens the database the way a restart would and runs the real recovery. */
function recover(outcome: CrashOutcome) {
  const database = SqliteDatabase.open(outcome.databasePath)
  try {
    const events = new EventLogService(database)
    const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const interests = new InterestService(new SqliteInterestRepository(database), events)
    const selfModel = new SelfModelService(new SqliteSelfModelRepository(database), events)
    const provider = new StubProvider()
    const states = new SqliteTurnStateRepository(database)
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
      selfModelLoop: { events, interests, selfModel },
      continuity: {
        contexts: new SqliteTurnContextRepository(database),
        pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
        finalizations: new SqliteTurnFinalizationRepository(database),
        states
      }
    })
    const first = companion.recoverInterruptedTurns()
    const second = companion.recoverInterruptedTurns()
    const messages = companion.readConversation({ conversationId: outcome.conversationId }).messages
    return {
      first,
      second,
      providerCalls: provider.calls,
      userMessages: messages.filter((message) => message.role === 'user').length,
      assistantMessages: messages.filter((message) => message.role === 'assistant').length,
      state: states.get(outcome.turnId)?.state ?? null,
      finalization: new SqliteTurnFinalizationRepository(database).get(outcome.turnId)
    }
  } finally {
    database.close()
  }
}

describe('B4 process-level crash recovery', () => {
  it('invents nothing when the process dies before the provider is called', async () => {
    const outcome = await crashAt('before-provider')
    expect(outcome.barrier.providerCalls).toBe(0)
    const result = recover(outcome)
    // No answer existed and none may be created.
    expect(result.assistantMessages).toBe(0)
    expect(result.userMessages).toBe(0)
    expect(result.providerCalls).toBe(0)
    // A turn that never started is settled as failed, never as recovered.
    expect(result.first.completed).toBe(0)
    expect(result.state).toBe('failed')
  }, 120_000)

  it('settles a turn whose provider call was in flight, without re-sending it', async () => {
    const outcome = await crashAt('during-provider')
    // The request was handed to the provider; the outcome upstream is unknown.
    expect(outcome.barrier.providerCalls).toBe(1)
    const result = recover(outcome)
    expect(result.providerCalls).toBe(0)
    expect(result.userMessages).toBe(1)
    expect(result.assistantMessages).toBe(0)
    expect(result.first.interrupted).toBe(1)
    expect(result.state).toBe('failed')
    expect(result.finalization).toBeNull()
  }, 120_000)

  it('fails a turn that died after the provider answered but before the answer was stored', async () => {
    const outcome = await crashAt('after-provider-before-persist')
    expect(outcome.barrier.providerCalls).toBe(1)
    const result = recover(outcome)
    // The intent survived, so recovery knows the turn existed — and that no
    // answer was delivered. It must not ask the model again.
    expect(result.providerCalls).toBe(0)
    expect(result.first.interrupted).toBe(1)
    expect(result.userMessages).toBe(1)
    expect(result.assistantMessages).toBe(0)
    expect(result.state).toBe('failed')
    expect(result.finalization).toBeNull()
  }, 120_000)

  it('completes a turn whose cleanup failed after the answer was stored', async () => {
    const outcome = await crashAt('cleanup-failure')
    expect(outcome.barrier.providerCalls).toBe(1)
    const result = recover(outcome)
    expect(result.first.completed).toBe(1)
    expect(result.providerCalls).toBe(0)
    expect(result.userMessages).toBe(1)
    expect(result.assistantMessages).toBe(1)
    expect(result.state).toBe('committed')
    expect(result.finalization).toBeNull()
  }, 120_000)

  it('does nothing on a second recovery pass in every window', async () => {
    for (const stage of ['during-provider', 'after-provider-before-persist', 'cleanup-failure']) {
      const outcome = await crashAt(stage)
      const result = recover(outcome)
      expect(result.second.completed + result.second.interrupted).toBe(0)
      expect(result.assistantMessages).toBeLessThanOrEqual(1)
    }
  }, 300_000)
})

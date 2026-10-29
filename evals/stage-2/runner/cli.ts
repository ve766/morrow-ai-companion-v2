/**
 * Stage 2 offline scenario runner.
 *
 * What this is: a real executor. It builds the real `CompanionService` against a
 * temporary SQLite database and drives it through `sendChat`, so every assertion
 * reads the serialized provider request, the database, or the turn record.
 *
 * What this is not: a model-quality benchmark. The provider is scripted, so
 * scenarios that would depend on model semantics cannot be judged here and are
 * reported as NOT_RUN (or BLOCKED when they need a credential). The scripted
 * provider is labelled in the result file, never presented as a real model.
 */
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SqliteDatabase } from '../../../src/persistence/database'
import { MemoryService } from '../../../src/memory/memory-service'
import { SqliteMemoryRepository } from '../../../src/persistence/memory-repository'
import { ConversationService } from '../../../src/conversation/conversation-service'
import { SqliteConversationRepository } from '../../../src/persistence/conversation-repository'
import { CompanionService } from '../../../src/app/companion-service'
import { SqliteTurnContextRepository, SqliteTurnFinalizationRepository, SqlitePendingItemRepository } from '../../../src/persistence/cognitive-context-repository'
import { PendingCognitionService } from '../../../src/cognition/pending-items'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../../../src/shared/companion'
import { MemorySecretStore } from '../../../src/security/secrets'
import type { ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from '../../../src/providers/provider-policy'

const DATASET_VERSION = 'v1'
const HARNESS_VERSION = 'stage-2-runner-v1'

class ScriptedProvider implements ProviderPort {
  readonly profile: ProviderProfile = { id: DEEPSEEK_PROVIDER_ID, providerClass: 'mock', configured: true }
  calls = 0
  lastPayload = ''

  async generate(input: ProviderInput): Promise<ProviderOutput> {
    this.calls += 1
    this.lastPayload = JSON.stringify(input.requestPayload)
    return { text: '好的。', modelId: 'scripted-offline', attempts: 1 }
  }
}

interface Assertion {
  name: string
  ok: boolean
  detail: string
}

type ScenarioStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED' | 'NOT_RUN'

interface ScenarioOutcome {
  id: string
  status: ScenarioStatus
  assertions: Assertion[]
  error?: string
  blockedBy?: string
  notRunReason?: string
}

interface Stack {
  companion: CompanionService
  memories: MemoryService
  provider: ScriptedProvider
  close: () => void
}

function buildStack(): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-stage2-eval-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const provider = new ScriptedProvider()
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
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database)
    }
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-placeholder-key' })
  // Retrieval only runs when the cognitive core is on; without this the
  // scenarios would "pass" the retraction checks for the wrong reason.
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    provider,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }
}

function deliveredMemoryIds(payload: string): string[] {
  // The memory block is JSON nested inside the system message, so its quotes
  // arrive escaped. Unescaping the whole payload is safe here: this string is
  // only scanned, never sent anywhere or stored.
  const unescaped = payload.replace(/\\"/gu, '"')
  const marker = unescaped.indexOf('"memories":[')
  if (marker < 0) return []
  const window = unescaped.slice(marker, marker + 8000)
  return [...window.matchAll(/"id":"([0-9a-f-]{36})"/gu)].map((match) => match[1]!)
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

function outcome(id: string, assertions: Assertion[]): ScenarioOutcome {
  const status: ScenarioStatus = assertions.length > 0 && assertions.every((item) => item.ok) ? 'PASS' : 'FAIL'
  return { id, status, assertions }
}

const scenarios: Array<{ id: string; name: string; run: (stack: Stack) => Promise<ScenarioOutcome> }> = [
  {
    id: 'B',
    name: 'cross-session memory',
    run: async (stack) => {
      const memory = stack.memories.create('我住在杭州。', 'personal')
      const first = stack.companion.createConversation()
      await send(stack, first.id, '我住在哪里？')
      const firstIds = deliveredMemoryIds(stack.provider.lastPayload)
      // A second conversation is the same thing the product does on "new chat".
      const second = stack.companion.createConversation()
      await send(stack, second.id, '我之前说我住在哪里？')
      const secondIds = deliveredMemoryIds(stack.provider.lastPayload)
      return outcome('B', [
        { name: 'the memory is delivered in the first session', ok: firstIds.includes(memory.id), detail: `delivered=${firstIds.length}` },
        { name: 'the memory is delivered in a later session', ok: secondIds.includes(memory.id), detail: `delivered=${secondIds.length}` }
      ])
    }
  },
  {
    id: 'D',
    name: 'retraction and deletion',
    run: async (stack) => {
      const memory = stack.memories.create('我有一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      await send(stack, conversation.id, '我的猫叫什么名字？')
      const controlIds = deliveredMemoryIds(stack.provider.lastPayload)
      stack.memories.retract(memory.id)
      await send(stack, conversation.id, '我的猫叫什么名字？')
      const afterPayload = stack.provider.lastPayload
      const afterIds = deliveredMemoryIds(afterPayload)
      return outcome('D', [
        { name: 'control: the value is deliverable before retraction', ok: controlIds.includes(memory.id), detail: `delivered=${controlIds.length}` },
        { name: 'the retracted memory id is absent afterwards', ok: !afterIds.includes(memory.id), detail: `delivered=${afterIds.length}` },
        { name: 'the retracted value is absent from the payload', ok: !afterPayload.includes('咪咪'), detail: 'text scan' }
      ])
    }
  },
  {
    id: 'I',
    name: 'retry and idempotency',
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const requestId = randomUUID()
      const callsBefore = stack.provider.calls
      const first = await send(stack, conversation.id, '你好。', requestId)
      const second = await send(stack, conversation.id, '你好。', requestId)
      const assistants = stack.companion.readConversation({ conversationId: conversation.id }).messages
        .filter((message) => message.role === 'assistant')
      const providerCalls = stack.provider.calls - callsBefore
      return outcome('I', [
        { name: 'a repeated requestId produces exactly one assistant message', ok: assistants.length === 1, detail: `assistants=${assistants.length}` },
        { name: 'the repeated call returns the same assistant message', ok: first.assistantMessage.id === second.assistantMessage.id, detail: 'identity' },
        { name: 'the provider is called once', ok: providerCalls === 1, detail: `calls=${providerCalls}` }
      ])
    }
  }
]

/** Scenarios that this runner cannot execute, with the reason recorded honestly. */
const unexecuted: ScenarioOutcome[] = [
  { id: 'A', status: 'NOT_RUN', assertions: [], notRunReason: 'needs a scenario that asserts reference resolution in the turn context; not implemented yet' },
  { id: 'C', status: 'NOT_RUN', assertions: [], notRunReason: 'correction path exists but no scenario asserts the revision chain yet' },
  { id: 'E', status: 'NOT_RUN', assertions: [], notRunReason: 'personality stability needs a multi-turn script; not implemented yet' },
  { id: 'F', status: 'NOT_RUN', assertions: [], notRunReason: 'state influence needs a controlled state revision; not implemented yet' },
  { id: 'G', status: 'NOT_RUN', assertions: [], notRunReason: 'interest promotion needs cross-session evidence; not implemented yet' },
  { id: 'H', status: 'NOT_RUN', assertions: [], notRunReason: 'reflection rate limiting needs a clock fixture; not implemented yet' },
  { id: 'J', status: 'NOT_RUN', assertions: [], notRunReason: 'payload hash equality is covered by integration tests, not by this runner' },
  { id: 'K', status: 'BLOCKED', assertions: [], blockedBy: 'no real provider credential in this environment' },
  { id: 'L', status: 'BLOCKED', assertions: [], blockedBy: 'Chromium renderer sandbox cannot start on this host' }
]

async function main(): Promise<void> {
  const headSha = process.env.MORROW_EVAL_HEAD ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  const startedAt = new Date().toISOString()
  const results: ScenarioOutcome[] = []

  for (const scenario of scenarios) {
    const stack = buildStack()
    try {
      results.push(await scenario.run(stack))
    } catch (error) {
      results.push({
        id: scenario.id,
        status: 'FAIL',
        assertions: [],
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      })
    } finally {
      stack.close()
    }
  }
  results.push(...unexecuted)

  const counts = {
    executed: results.filter((item) => item.status === 'PASS' || item.status === 'FAIL').length,
    passed: results.filter((item) => item.status === 'PASS').length,
    failed: results.filter((item) => item.status === 'FAIL').length,
    skipped: results.filter((item) => item.status === 'SKIPPED').length,
    blocked: results.filter((item) => item.status === 'BLOCKED').length,
    notRun: results.filter((item) => item.status === 'NOT_RUN').length
  }
  const denominator = counts.passed + counts.failed
  const summary = {
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    headSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    providerMode: 'scripted',
    providerNote: 'The provider returns fixed text. This runner proves wiring and payload contents, never model quality.',
    counts,
    passRate: denominator === 0 ? null : counts.passed / denominator,
    passRateDenominator: 'PASS + FAIL only; SKIPPED, BLOCKED and NOT_RUN are excluded, never counted as passing.'
  }

  // Bundled to CJS, so the results directory is resolved from the repo root
  // the script is started from (documented in the ablation/README).
  const directory = resolve(process.cwd(), 'evals/stage-2/results')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const base = `${stamp}-${headSha.slice(0, 7)}`
  writeFileSync(join(directory, `${base}.json`), `${JSON.stringify({ ...summary, scenarios: results }, null, 2)}\n`)
  writeFileSync(join(directory, `${base}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`)

  for (const item of results) {
    console.log(`${item.id}: ${item.status}${item.assertions.length > 0 ? ` (${item.assertions.filter((a) => a.ok).length}/${item.assertions.length} assertions)` : ''}${item.error ? ` error=${item.error}` : ''}${item.notRunReason ? ` — ${item.notRunReason}` : ''}${item.blockedBy ? ` — ${item.blockedBy}` : ''}`)
  }
  console.log(`counts: ${JSON.stringify(counts)} report=${join(directory, `${base}.json`)}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})

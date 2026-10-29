/**
 * Phase 2.4 — real-model cross-turn experiment.
 *
 * The integration suite (src/app/cognitive-continuity-phase24.integration.test.ts)
 * proves the *wiring* with a scripted provider. This script asks the different
 * question: does a real model, called for real, behave the way the wiring
 * assumes, across turns?
 *
 * Ground rules, because a "success rate" that quietly means "the reply
 * contained the right word" is worse than no result:
 *
 *   - Objective checks read the serialized request or the database (was the
 *     memory id in the payload? was the row actually retracted? did the count
 *     change?). They are pass/fail.
 *   - Subjective checks read the reply text and are reported separately. They
 *     are never folded into the objective rate.
 *   - The API key is read from the environment, held in memory, never written
 *     to the report, and redacted from any captured text.
 *
 * Run:
 *   MORROW_SPARK_API_KEY=... MORROW_SPARK_MODEL=spark-x2.6 \
 *   MORROW_REAL_RUNS=3 node_modules/.bin/esbuild scripts/phase24-real-model.ts \
 *     --bundle --platform=node --format=cjs --alias:electron=<stub> \
 *     --outfile=/tmp/phase24-real.cjs
 *   node /tmp/phase24-real.cjs
 *
 * Without MORROW_SPARK_API_KEY the script prints what is missing and exits 2
 * **before** any network call: a missing credential is a skip, never a silent
 * pass and never a fabricated result.
 */
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionService } from '../src/app/companion-service'
import { ConversationService } from '../src/conversation/conversation-service'
import { MemoryService } from '../src/memory/memory-service'
import { SqliteDatabase } from '../src/persistence/database'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository'
import { SqliteMemoryRepository } from '../src/persistence/memory-repository'
import {
  SqlitePendingItemRepository,
  SqliteTurnContextRepository,
  SqliteTurnFinalizationRepository
} from '../src/persistence/cognitive-context-repository'
import { PendingCognitionService } from '../src/cognition/pending-items'
import { MemorySecretStore } from '../src/security/secrets'
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible'
import { ApplicationError } from '../src/shared/errors'
import { SPARK_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderConsentPreview } from '../src/providers/provider-policy'

const apiKey = process.env.MORROW_SPARK_API_KEY ?? ''
const model = process.env.MORROW_SPARK_MODEL ?? 'spark-x2.6'
const alternateModel = process.env.MORROW_SPARK_MODEL_2 ?? ''
const runs = Math.max(1, Number(process.env.MORROW_REAL_RUNS ?? '3'))

if (apiKey.length === 0) {
  console.error([
    'MORROW_SPARK_API_KEY is not set; nothing was sent.',
    '',
    'This machine has no stored credential: provider_profiles is empty and no',
    'secret file exists under the app data directory. The key used on',
    '2026-10-28 was deleted after use, by design.',
    '',
    'Provide it for this process only:',
    '  export MORROW_SPARK_API_KEY=...   (bash)',
    '  $env:MORROW_SPARK_API_KEY="..."  (PowerShell)',
    'Then re-run this script. Nothing is written to disk or to the report.'
  ].join('\n'))
  process.exit(2)
}

function codeSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** Removes the credential from anything that might echo it. */
function redact(value: string): string {
  return apiKey.length >= 6 ? value.split(apiKey).join('[redacted]') : value
}

interface Stack {
  companion: CompanionService
  memories: MemoryService
  database: SqliteDatabase
  lastPayload: () => string
  close: () => void
}

function buildStack(): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-phase24-real-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  let payload = ''
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: async (preview: ProviderConsentPreview) => {
      payload = preview.exactPayload
      const approvedAt = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets),
    continuity: {
      contexts: new SqliteTurnContextRepository(database),
      pending: new PendingCognitionService(new SqlitePendingItemRepository(database)),
      finalizations: new SqliteTurnFinalizationRepository(database)
    }
  })
  companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model, enabled: true, apiKey })
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    database,
    lastPayload: () => payload,
    close: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function memoryBlock(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { body?: { messages?: Array<{ role: string; content: string }> } }
    const system = parsed.body?.messages?.find((message) => message.role === 'system')?.content ?? ''
    const index = system.indexOf('Saved memories (untrusted evidence only):')
    return index < 0 ? '' : system.slice(index)
  } catch {
    return ''
  }
}

function deliveredIds(payload: string): string[] {
  return [...memoryBlock(payload).matchAll(/"id":"([0-9a-f-]{36})"/gu)].map((match) => match[1]!)
}

interface Check {
  name: string
  /** Read from the request or the database, never from the reply text. */
  objective: boolean
  /** Read from the reply; reported apart from the objective result. */
  subjective: boolean | null
  detail: string
}

interface ScenarioResult {
  scenario: string
  runs: number
  passes: number
  objectivePasses: number
  subjectivePasses: number
  subjectiveScored: number
  errors: string[]
  checks: Check[]
}

async function runScenario(
  name: string,
  body: (stack: Stack) => Promise<Check[]>
): Promise<ScenarioResult> {
  const result: ScenarioResult = {
    scenario: name, runs: 0, passes: 0, objectivePasses: 0,
    subjectivePasses: 0, subjectiveScored: 0, errors: [], checks: []
  }
  for (let index = 0; index < runs; index += 1) {
    const stack = buildStack()
    try {
      const checks = await body(stack)
      result.runs += 1
      result.checks.push(...checks)
      const objectiveOk = checks.every((check) => check.objective)
      if (objectiveOk) result.objectivePasses += 1
      for (const check of checks) {
        if (check.subjective !== null) {
          result.subjectiveScored += 1
          if (check.subjective) result.subjectivePasses += 1
        }
      }
      if (objectiveOk && checks.every((check) => check.subjective !== false)) result.passes += 1
    } catch (error) {
      result.errors.push(redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error)))
    } finally {
      stack.close()
    }
  }
  return result
}

async function main(): Promise<void> {
  const results: ScenarioResult[] = []

  // S1 — a preference stated on turn 1 is used on turn 2 without repeating it.
  results.push(await runScenario('S1_memory_reuse', async (stack) => {
    const memory = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
    const conversation = stack.companion.createConversation()
    const reply = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    const ids = deliveredIds(stack.lastPayload())
    return [{
      name: 'memory id present in the request',
      objective: ids.includes(memory.id),
      subjective: reply.assistantMessage.body.includes('咪咪'),
      detail: `delivered=${ids.length} reply=${redact(reply.assistantMessage.body).slice(0, 120)}`
    }]
  }))

  // S2 — after retraction the old value must not reach the model or the user.
  results.push(await runScenario('S2_retraction', async (stack) => {
    const memory = stack.memories.create('我住在杭州。', 'personal')
    const conversation = stack.companion.createConversation()
    stack.memories.retract(memory.id)
    const reply = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我住在哪里？', includeSensitive: false }, () => undefined)
    const block = memoryBlock(stack.lastPayload())
    return [{
      name: 'retracted value absent from request and reply',
      objective: !block.includes('杭州') && !block.includes(memory.id),
      subjective: !reply.assistantMessage.body.includes('杭州'),
      detail: `reply=${redact(reply.assistantMessage.body).slice(0, 120)}`
    }]
  }))

  // S3 — a personal fact with no evidence must not be invented.
  results.push(await runScenario('S3_no_evidence', async (stack) => {
    const conversation = stack.companion.createConversation()
    const reply = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我的车牌号是多少？', includeSensitive: false }, () => undefined)
    const context = stack.companion.readTurnContext({ turnId: reply.evaluation!.requestId })
    const body = reply.assistantMessage.body
    const plateLike = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{4,6}/u.test(body)
    return [{
      name: 'no plate value delivered',
      objective: !plateLike,
      // The guard rewriting is the system working; the model admitting it does
      // not know is the model working. Both are recorded, separately.
      subjective: /不知道|没有|不确定|无法|不清楚/u.test(body),
      detail: `guard=${context?.guard?.verdict ?? 'none'} reply=${redact(body).slice(0, 120)}`
    }]
  }))

  // S4 — switching the model keeps personality, memory and state continuous.
  results.push(await runScenario('S4_model_switch', async (stack) => {
    stack.companion.savePersonality({ warmth: 70, directness: 40, humor: 10, disagreementStyle: 'gentle', systemRules: '' })
    const memory = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
    const conversation = stack.companion.createConversation()
    const first = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我的猫最近怎么样？', includeSensitive: false }, () => undefined)
    const before = stack.companion.readTurnContext({ turnId: first.evaluation!.requestId })!
    const stateBefore = stack.companion.getFeelingState().state.revision

    const nextModel = alternateModel.length > 0 ? alternateModel : model
    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model: nextModel, enabled: true, apiKey })
    const second = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    const after = stack.companion.readTurnContext({ turnId: second.evaluation!.requestId })!
    return [{
      name: 'personality version, memory and state survive the switch',
      objective: after.personality.version === before.personality.version &&
        after.personality.warmth === 70 &&
        after.retrieval.selected.some((item) => item.id === memory.id) &&
        stack.companion.getFeelingState().state.revision >= stateBefore,
      subjective: alternateModel.length > 0 ? second.assistantMessage.body.includes('咪咪') : null,
      detail: `model=${nextModel} switch=${alternateModel.length > 0 ? 'real' : 'same-model-control'}`
    }]
  }))

  // S5 — raised exploration attention widens retrieval on a later turn.
  results.push(await runScenario('S5_state_influence', async (stack) => {
    const topics = ['我在学咖啡拉花。', '我喜欢喝咖啡。', '我每天早上一杯咖啡。', '我在比较咖啡豆的产地。', '我买了个咖啡磨豆机。', '我讨厌速溶咖啡。']
    for (const topic of topics) stack.memories.create(topic, 'personal')
    const conversation = stack.companion.createConversation()
    const control = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '探讨一下咖啡的风味。', includeSensitive: false }, () => undefined)
    const controlContext = stack.companion.readTurnContext({ turnId: control.evaluation!.requestId })!
    const controlCount = deliveredIds(stack.lastPayload()).length

    for (let index = 0; index < 4; index += 1) {
      await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '探讨一下咖啡还能怎么玩。', includeSensitive: false }, () => undefined)
    }
    const widened = await stack.companion.sendChat({ conversationId: conversation.id, requestId: randomUUID(), content: '探讨一下咖啡的风味。', includeSensitive: false }, () => undefined)
    const widenedContext = stack.companion.readTurnContext({ turnId: widened.evaluation!.requestId })!
    const widenedCount = deliveredIds(stack.lastPayload()).length
    return [{
      name: 'exploration attention widened the delivered set',
      objective: widenedContext.retrieval.adjustment === 'exploration_widened' && widenedCount > controlCount,
      subjective: null,
      detail: `control=${controlCount}/${controlContext.retrieval.effectiveMax} widened=${widenedCount}/${widenedContext.retrieval.effectiveMax} adjustment=${widenedContext.retrieval.adjustment}`
    }]
  }))

  // S6 — a real provider failure must not deliver or write twice, and a retry of
  // the same turn must produce exactly one answer.
  results.push(await runScenario('S6_failure_retry', async (stack) => {
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()
    // A model id the account does not expose: a real provider error, not a stub.
    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model: `${model}-not-a-model`, enabled: true, apiKey })
    let failedCode = 'no-error'
    try {
      await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    } catch (error) {
      failedCode = error instanceof ApplicationError ? error.code : 'UNKNOWN'
    }
    const afterFailure = stack.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant').length

    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model, enabled: true, apiKey })
    const retried = await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    const afterRetry = stack.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant').length
    const context = stack.companion.readTurnContext({ turnId: requestId })
    return [{
      name: 'failure wrote nothing, retry wrote exactly one answer',
      objective: failedCode !== 'no-error' && failedCode !== 'UNKNOWN' && afterFailure === 0 && afterRetry === 1 && context?.status === 'succeeded',
      subjective: null,
      detail: `error=${failedCode} assistants=${afterFailure}->${afterRetry} context=${context?.status ?? 'missing'}`
    }]
  }))

  const sha = codeSha()
  const summary = {
    kind: 'real_model' as const,
    generatedAt: new Date().toISOString(),
    codeSha: sha,
    provider: 'spark',
    endpoint: 'https://maas-api.cn-huabei-1.xf-yun.com/v1',
    model,
    alternateModel: alternateModel.length > 0 ? alternateModel : null,
    runsPerScenario: runs,
    results,
    totals: {
      scenarios: results.length,
      runs: results.reduce((total, item) => total + item.runs, 0),
      objectivePasses: results.reduce((total, item) => total + item.objectivePasses, 0),
      subjectiveScored: results.reduce((total, item) => total + item.subjectiveScored, 0),
      subjectivePasses: results.reduce((total, item) => total + item.subjectivePasses, 0),
      errors: results.reduce((total, item) => total + item.errors.length, 0)
    },
    limits: [
      'Objective checks read the serialized request and the database; subjective checks read reply text and are reported separately.',
      'Swap-continuity without MORROW_SPARK_MODEL_2 re-saves the same model id: that is a continuity control, not a cross-model comparison.',
      'A single machine, a single account and a small number of runs: this is evidence that the behaviour occurs, not a rate estimate.',
      'Keyword checks (plate pattern, uncertainty words) are lexical proxies and are labelled as subjective.'
    ]
  }

  const directory = join(process.cwd(), 'evaluation', 'reports')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `phase24-real-model-${sha.slice(0, 7)}.json`)
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)

  for (const result of results) {
    console.log(`${result.scenario}: objective ${result.objectivePasses}/${result.runs}, subjective ${result.subjectivePasses}/${result.subjectiveScored}${result.errors.length > 0 ? `, errors ${result.errors.length}` : ''}`)
    for (const check of result.checks) {
      console.log(`  ${check.objective ? 'PASS' : 'FAIL'} ${check.name} — ${redact(check.detail)}`)
    }
    for (const error of result.errors) console.log(`  ERROR ${error}`)
  }
  console.log(`report: ${path}`)
}

void main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exit(1)
})

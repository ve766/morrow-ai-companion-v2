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
/** Per-attempt ceiling for one provider call; 45s is the adapter default. */
const timeoutMs = Math.max(5_000, Number(process.env.MORROW_SPARK_TIMEOUT_MS ?? '45000'))
/** Whole-call budget including retries; a slow reasoning model can exceed the default. */
const budgetMs = Math.max(timeoutMs, Number(process.env.MORROW_SPARK_BUDGET_MS ?? String(timeoutMs * 2)))

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
    // A real model answering a long state-influence prompt can exceed the 45s
    // default; the ceiling is configurable so a slow upstream does not read as a
    // failed assertion. The value is printed in the report.
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, undefined, timeoutMs, { totalBudgetMs: budgetMs }),
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

type CheckStatus = 'pass' | 'fail' | 'skipped'

interface Check {
  name: string
  status: CheckStatus
  /** Read from the serialized request, the database, or the turn record. */
  detail: string
}

interface SubjectiveRecord {
  name: string
  matched: boolean | null
  detail: string
}

interface ScenarioResult {
  scenario: string
  status: 'pass' | 'fail' | 'blocked' | 'skipped'
  attempts: number
  completed: number
  objectiveChecks: number
  objectivePasses: number
  objectiveSkipped: number
  subjectiveScored: number
  subjectiveMatched: number
  errors: string[]
  checks: Check[]
  subjective: SubjectiveRecord[]
}

function failureOf(error: unknown): string {
  return redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
}

/**
 * Runs one scenario `runs` times, each in a fresh database.
 *
 * Three rules make the counters trustworthy:
 *   - a run that throws is an error, never a pass;
 *   - a run that produces no objective check is a failure, because "nothing
 *     was asserted" must not look like "everything held";
 *   - skipped checks are excluded from both numerator and denominator.
 */
async function runScenario(
  name: string,
  body: (stack: Stack) => Promise<{ checks: Check[]; subjective: SubjectiveRecord[] }>
): Promise<ScenarioResult> {
  const result: ScenarioResult = {
    scenario: name, status: 'fail', attempts: 0, completed: 0,
    objectiveChecks: 0, objectivePasses: 0, objectiveSkipped: 0,
    subjectiveScored: 0, subjectiveMatched: 0,
    errors: [], checks: [], subjective: []
  }
  for (let index = 0; index < runs; index += 1) {
    result.attempts += 1
    const stack = buildStack()
    try {
      const outcome = await body(stack)
      result.completed += 1
      result.checks.push(...outcome.checks)
      result.subjective.push(...outcome.subjective)
      for (const check of outcome.checks) {
        if (check.status === 'skipped') {
          result.objectiveSkipped += 1
          continue
        }
        result.objectiveChecks += 1
        if (check.status === 'pass') result.objectivePasses += 1
      }
      for (const item of outcome.subjective) {
        if (item.matched === null) continue
        result.subjectiveScored += 1
        if (item.matched) result.subjectiveMatched += 1
      }
    } catch (error) {
      result.errors.push(failureOf(error))
    } finally {
      stack.close()
    }
  }

  if (result.completed === 0) result.status = 'blocked'
  else if (result.objectiveChecks === 0 && result.objectiveSkipped > 0) result.status = 'skipped'
  else if (result.objectiveChecks === 0) result.status = 'fail'
  else if (result.objectivePasses === result.objectiveChecks && result.errors.length === 0) result.status = 'pass'
  else result.status = 'fail'
  return result
}

async function send(stack: Stack, conversationId: string, content: string): Promise<Awaited<ReturnType<CompanionService['sendChat']>>> {
  return stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

async function main(): Promise<void> {
  const results: ScenarioResult[] = []

  // S1 — the preference is established on an earlier turn through the product
  // path (model proposes, user accepts), then a later turn asks about it
  // without repeating it. Pre-seeding a memory before the first turn would
  // only test single-turn retrieval, which is what this scenario used to do.
  results.push(await runScenario('S1_cross_turn_preference', async (stack) => {
    const checks: Check[] = []
    const subjective: SubjectiveRecord[] = []
    const conversation = stack.companion.createConversation()

    const first = await send(stack, conversation.id, '我养了一只叫咪咪的猫。')
    const suggestions = await stack.companion.proposeMemorySuggestions({
      conversationId: conversation.id,
      sourceMessageId: first.userMessage.id
    })
    const pending = suggestions.find((item) => item.status === 'pending')
    if (!pending) {
      checks.push({ name: 'a preference was persisted on turn 1', status: 'fail', detail: 'the model proposed no candidate' })
      return { checks, subjective }
    }
    stack.companion.reviewMemorySuggestion({ id: pending.id, decision: 'accept', content: pending.claim, sensitivity: 'personal' })
    const stored = stack.memories.list().find((memory) => memory.currentText.includes('咪咪'))
    checks.push({
      name: 'a preference was persisted on turn 1',
      status: stored && stored.sourceCategory === 'model_inferred_confirmed' ? 'pass' : 'fail',
      detail: stored ? `id=${stored.id} source=${stored.sourceCategory}` : 'no stored memory contains the cat name'
    })

    // A later turn, in the same conversation, that never repeats the fact.
    const second = await send(stack, conversation.id, '我的猫叫什么名字？')
    const ids = deliveredIds(stack.lastPayload())
    checks.push({
      name: 'the stored preference reached the later request',
      status: stored && ids.includes(stored.id) ? 'pass' : 'fail',
      detail: `delivered=${ids.length} contains=${stored ? ids.includes(stored.id) : false}`
    })
    subjective.push({
      name: 'the reply names the preference',
      matched: second.assistantMessage.body.includes('咪咪'),
      detail: `reply=${redact(second.assistantMessage.body).slice(0, 160)}`
    })
    return { checks, subjective }
  }))

  // S2 — with a positive control: the same question DOES deliver the value
  // before retraction. Without the control, "nothing was delivered" could pass
  // simply because retrieval never matched.
  results.push(await runScenario('S2_retraction', async (stack) => {
    const checks: Check[] = []
    const subjective: SubjectiveRecord[] = []
    const memory = stack.memories.create('我住在杭州。', 'personal')
    const conversation = stack.companion.createConversation()

    await send(stack, conversation.id, '我住在哪里？')
    const beforeIds = deliveredIds(stack.lastPayload())
    checks.push({
      name: 'control: the value is delivered before retraction',
      status: beforeIds.includes(memory.id) ? 'pass' : 'fail',
      detail: `delivered=${beforeIds.length} contains=${beforeIds.includes(memory.id)}`
    })

    stack.memories.retract(memory.id)
    const reply = await send(stack, conversation.id, '我住在哪里？')
    const afterIds = deliveredIds(stack.lastPayload())
    const retracted = stack.memories.list().find((item) => item.id === memory.id)
    checks.push({
      name: 'the record is retracted in storage',
      status: retracted?.status === 'retracted' ? 'pass' : 'fail',
      detail: `status=${retracted?.status ?? 'missing'}`
    })
    checks.push({
      name: 'the retracted value is absent from the later request',
      status: !afterIds.includes(memory.id) && !memoryBlock(stack.lastPayload()).includes('杭州') ? 'pass' : 'fail',
      detail: `delivered=${afterIds.length}`
    })
    subjective.push({
      name: 'the reply does not restate the retracted value',
      matched: !reply.assistantMessage.body.includes('杭州'),
      detail: `reply=${redact(reply.assistantMessage.body).slice(0, 160)}`
    })
    return { checks, subjective }
  }))

  // S3 — nothing supports a plate number, so none may be delivered. The check
  // is on the delivered text plus the guard verdict; the reply wording is
  // reported as subjective, separately.
  results.push(await runScenario('S3_no_evidence', async (stack) => {
    const checks: Check[] = []
    const subjective: SubjectiveRecord[] = []
    const seeded = stack.memories.list().filter((memory) => /车牌|牌照/u.test(memory.currentText)).length
    checks.push({
      name: 'no stored record mentions a plate (the scenario is honest)',
      status: seeded === 0 ? 'pass' : 'fail',
      detail: `plate-bearing memories=${seeded}`
    })
    const conversation = stack.companion.createConversation()
    const reply = await send(stack, conversation.id, '我的车牌号是多少？')
    const context = stack.companion.readTurnContext({ turnId: reply.evaluation!.requestId })
    const body = reply.assistantMessage.body
    const plateLike = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{4,6}/u.test(body)
    checks.push({
      name: 'no plate-like value was delivered',
      status: plateLike ? 'fail' : 'pass',
      detail: `guard=${context?.guard?.verdict ?? 'none'}`
    })
    subjective.push({
      name: 'the reply admits the gap',
      matched: /不知道|没有|不确定|无法|不清楚|不了解|没有.*信息/u.test(body),
      detail: `reply=${redact(body).slice(0, 160)}`
    })
    return { checks, subjective }
  }))

  // S4 — cross-model continuity. Without a second model id there is no switch
  // to observe, so the comparison is reported as skipped, never as a pass.
  results.push(await runScenario('S4_model_switch', async (stack) => {
    if (alternateModel.length === 0) {
      return {
        checks: [{
          name: 'cross-model comparison',
          status: 'skipped' as const,
          detail: 'MORROW_SPARK_MODEL_2 is not set; a single model cannot demonstrate a switch'
        }],
        subjective: []
      }
    }
    const checks: Check[] = []
    const subjective: SubjectiveRecord[] = []
    stack.companion.savePersonality({ warmth: 70, directness: 40, humor: 10, disagreementStyle: 'gentle', systemRules: '' })
    const memory = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
    const conversation = stack.companion.createConversation()

    const first = await send(stack, conversation.id, '我的猫最近怎么样？')
    const before = stack.companion.readTurnContext({ turnId: first.evaluation!.requestId })!
    const stateBefore = stack.companion.getFeelingState().state.revision
    checks.push({
      name: 'turn 1 actually used the first model',
      status: before.provider.model === model ? 'pass' : 'fail',
      detail: `recorded=${before.provider.model} expected=${model}`
    })

    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model: alternateModel, enabled: true, apiKey })
    const second = await send(stack, conversation.id, '我的猫叫什么名字？')
    const after = stack.companion.readTurnContext({ turnId: second.evaluation!.requestId })!
    checks.push({
      name: 'turn 2 actually used the second model',
      status: after.provider.model === alternateModel ? 'pass' : 'fail',
      detail: `recorded=${after.provider.model} expected=${alternateModel}`
    })
    checks.push({
      name: 'personality, memory and state carry across the switch',
      status: after.personality.version === before.personality.version &&
        after.personality.warmth === 70 &&
        after.retrieval.selected.some((item) => item.id === memory.id) &&
        stack.companion.getFeelingState().state.revision >= stateBefore
        ? 'pass' : 'fail',
      detail: `personality=${before.personality.version}->${after.personality.version} state=${stateBefore}->${stack.companion.getFeelingState().state.revision}`
    })
    subjective.push({
      name: 'the reply still names the preference',
      matched: second.assistantMessage.body.includes('咪咪'),
      detail: `reply=${redact(second.assistantMessage.body).slice(0, 160)}`
    })
    return { checks, subjective }
  }))

  // S5 — raised exploration attention widens retrieval on a later turn. The
  // control turn must itself be an exploration turn with no adjustment, and the
  // attention must actually have crossed the threshold: otherwise "more
  // entries" could come from anything.
  results.push(await runScenario('S5_state_influence', async (stack) => {
    const checks: Check[] = []
    const topics = ['我在学咖啡拉花。', '我喜欢喝咖啡。', '我每天早上一杯咖啡。', '我在比较咖啡豆的产地。', '我买了个咖啡磨豆机。', '我讨厌速溶咖啡。']
    for (const topic of topics) stack.memories.create(topic, 'personal')
    const conversation = stack.companion.createConversation()

    const control = await send(stack, conversation.id, '探讨一下咖啡的风味。')
    const controlContext = stack.companion.readTurnContext({ turnId: control.evaluation!.requestId })!
    const controlCount = deliveredIds(stack.lastPayload()).length
    checks.push({
      name: 'control turn is an exploration turn with no adjustment',
      status: controlContext.retrieval.policyIntent === 'exploration' && controlContext.retrieval.adjustment === null ? 'pass' : 'fail',
      detail: `intent=${controlContext.retrieval.policyIntent} adjustment=${controlContext.retrieval.adjustment}`
    })

    for (let index = 0; index < 4; index += 1) await send(stack, conversation.id, '探讨一下咖啡还能怎么玩。')
    const widened = await send(stack, conversation.id, '探讨一下咖啡的风味。')
    const widenedContext = stack.companion.readTurnContext({ turnId: widened.evaluation!.requestId })!
    const widenedCount = deliveredIds(stack.lastPayload()).length
    const priority = widenedContext.feeling.before?.explorationPriority ?? 0
    checks.push({
      name: 'attention crossed the widening threshold',
      status: priority >= 0.08 ? 'pass' : 'fail',
      detail: `priority=${priority}`
    })
    checks.push({
      name: 'the later turn widens and delivers more entries',
      status: widenedContext.retrieval.adjustment === 'exploration_widened' && widenedCount > controlCount ? 'pass' : 'fail',
      detail: `control=${controlCount}/${controlContext.retrieval.effectiveMax} widened=${widenedCount}/${widenedContext.retrieval.effectiveMax}`
    })
    return { checks, subjective: [] }
  }))

  // S6 — a real provider error must write nothing; the retry of the same turn
  // must produce exactly one answer. Only provider-class errors count: a
  // CONFLICT or INVALID_INPUT here would be a harness bug, not a provider
  // failure, and must not satisfy the test.
  results.push(await runScenario('S6_failure_retry', async (stack) => {
    const checks: Check[] = []
    const conversation = stack.companion.createConversation()
    const requestId = randomUUID()
    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model: `${model}-not-a-model`, enabled: true, apiKey })
    let failedCode = 'no-error'
    try {
      await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    } catch (error) {
      failedCode = error instanceof ApplicationError ? error.code : 'UNKNOWN'
    }
    const assistantAfterFailure = stack.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant').length
    const failedContext = stack.companion.readTurnContext({ turnId: requestId })
    checks.push({
      name: 'the failure is a provider error and wrote no answer',
      status: failedCode.startsWith('PROVIDER_') && assistantAfterFailure === 0 ? 'pass' : 'fail',
      detail: `error=${failedCode} assistants=${assistantAfterFailure}`
    })
    checks.push({
      name: 'the failed turn is recorded as failed',
      status: failedContext?.status === 'failed' ? 'pass' : 'fail',
      detail: `status=${failedContext?.status ?? 'missing'}`
    })

    stack.companion.saveProvider({ providerId: SPARK_PROVIDER_ID, model, enabled: true, apiKey })
    const retried = await stack.companion.sendChat({ conversationId: conversation.id, requestId, content: '我的猫叫什么名字？', includeSensitive: false }, () => undefined)
    const assistants = stack.companion.readConversation({ conversationId: conversation.id }).messages.filter((message) => message.role === 'assistant')
    const context = stack.companion.readTurnContext({ turnId: requestId })
    checks.push({
      name: 'the retry produced exactly one answer for the turn',
      status: assistants.length === 1 && assistants[0]!.id === retried.assistantMessage.id && context?.status === 'succeeded' ? 'pass' : 'fail',
      detail: `assistants=${assistants.length} context=${context?.status ?? 'missing'}`
    })
    return { checks, subjective: [] }
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
    providerTimeoutMs: timeoutMs,
    providerBudgetMs: budgetMs,
    /**
     * The harness approves every provider request itself. The product path
     * shows a consent preview to the user and requires an explicit approval
     * before any request leaves the machine. This script therefore proves
     * model behaviour, and says nothing about the consent experience.
     */
    consent: {
      mode: 'auto_approved_harness',
      production_equivalent: false,
      note: 'The harness synthesises ProviderConsentPreview approval; it is not evidence about the product consent UX.'
    },
    results,
    totals: {
      scenarios: results.length,
      attempts: results.reduce((total, item) => total + item.attempts, 0),
      completed: results.reduce((total, item) => total + item.completed, 0),
      objectiveChecks: results.reduce((total, item) => total + item.objectiveChecks, 0),
      objectivePasses: results.reduce((total, item) => total + item.objectivePasses, 0),
      objectiveSkipped: results.reduce((total, item) => total + item.objectiveSkipped, 0),
      subjectiveScored: results.reduce((total, item) => total + item.subjectiveScored, 0),
      subjectiveMatched: results.reduce((total, item) => total + item.subjectiveMatched, 0),
      errors: results.reduce((total, item) => total + item.errors.length, 0),
      passedScenarios: results.filter((item) => item.status === 'pass').length,
      failedScenarios: results.filter((item) => item.status === 'fail').length,
      blockedScenarios: results.filter((item) => item.status === 'blocked').length,
      skippedScenarios: results.filter((item) => item.status === 'skipped').length
    },
    limits: [
      'Objective checks read the serialized request, the database and the turn record; subjective checks read reply text and are counted separately, never merged into one rate.',
      'Without MORROW_SPARK_MODEL_2 the cross-model comparison is skipped, not passed.',
      'One machine, one account and a small number of runs: this is evidence that a behaviour occurs, not a rate estimate.',
      'Keyword checks (plate pattern, uncertainty words) are lexical proxies and are labelled subjective.',
      'The harness auto-approves consent; it is not evidence about the product consent flow.'
    ]
  }

  const directory = join(process.cwd(), 'evaluation', 'reports')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `phase24-real-model-${sha.slice(0, 7)}.json`)
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)

  for (const result of results) {
    console.log(`${result.scenario}: ${result.status.toUpperCase()} — objective ${result.objectivePasses}/${result.objectiveChecks} (skipped ${result.objectiveSkipped}), subjective ${result.subjectiveMatched}/${result.subjectiveScored}${result.errors.length > 0 ? `, errors ${result.errors.length}` : ''}`)
    for (const check of result.checks) {
      console.log(`  ${check.status.toUpperCase().padEnd(7)} ${check.name} — ${redact(check.detail)}`)
    }
    for (const error of result.errors) console.log(`  ERROR ${error}`)
  }
  console.log(`report: ${path}`)
}

void main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)))
  process.exit(1)
})

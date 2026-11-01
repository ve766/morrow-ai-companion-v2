/**
 * C1 semantic suite — the only C1 artefact that may be quoted as evidence that
 * a *model* understood something.
 *
 * Why this file exists next to `run.ts`:
 *
 *   `run.ts` drives a scripted provider. It proves that the decision reaches the
 *   request payload and the database, and that different inputs produce
 *   different readings. It cannot prove language understanding, because the
 *   provider is a string. Reporting its pass count as intent accuracy is the
 *   exact error the split exists to prevent.
 *
 * What this suite does:
 *
 *   - it drives the same `CompanionService` against a real endpoint;
 *   - it records, per turn, the user's words, the model's reply, and the C1
 *     reading the product stored (slots, speech act, response mode,
 *     `mayExecute`, `supersedesMessageId`, context evidence);
 *   - it checks only *mechanical* preconditions: a reading was stored, a reply
 *     came back, no call died. Those are the only claims a rule set can grade
 *     about a real model.
 *
 * What it deliberately does NOT do:
 *
 *   - it does not mark semantic correctness PASS or FAIL. Whether the second
 *     turn's "那" was understood, whether "会不会更清楚" was answered instead of
 *     executed, is a judgement about meaning. It is recorded as
 *     `manualReview.status = 'PENDING'` with the rows a human must read;
 *   - it does not report a score. Every stored number is `heuristic_score`
 *     (`confidenceBand`, rule strength), never a calibrated probability;
 *   - it does not turn a missing secret into a pass or a crash: that is
 *     `BLOCKED_NO_SECRET`, written by the shared module.
 *
 * Usage:
 *   MORROW_TEST_API_KEY=... MORROW_EVAL_SHA=$(git rev-parse HEAD) \
 *     npm run eval:stage3:intent:semantic
 *
 * Exit codes: 0 = ran and awaits review, or blocked with no secret; 1 = the
 * mechanism the suite observes was absent (a reading or reply is missing).
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  assertNoSecret,
  buildProviderStack,
  commitOrUnknown,
  payloadDigest,
  readKeyOrNull,
  resolveContractUrl,
  selectProvider,
  workingTreeDirty,
  writeBlockedNoSecret
} from '../shared/real-provider'
import type { IntentReading } from '../../../src/cognition/intent-reading'

export const DATASET_VERSION = 'c1-semantic-v1'
export const HARNESS_VERSION = 'c1-semantic-runner-v1'
export const PARAMS_VERSION = 'c1-params-v1'

interface Assertion { name: string; ok: boolean; detail: string }

/**
 * A reading projected field by field.
 *
 * Typed through indexed access on `IntentReading` rather than restated by hand:
 * a field that the product renames or drops must fail to compile here instead
 * of quietly leaving a stale key in the evidence file.
 */
interface ReadingProjection {
  version: IntentReading['version']
  algorithmVersion: IntentReading['algorithmVersion']
  parameterVersion: IntentReading['parameterVersion']
  primaryIntent: IntentReading['primaryIntent']
  secondaryIntents: IntentReading['secondaryIntents']
  intentStatus: IntentReading['intentStatus']
  responseMode: IntentReading['responseMode']
  mayExecute: IntentReading['mayExecute']
  clarificationRequired: IntentReading['clarificationRequired']
  clarificationReason: IntentReading['clarificationReason']
  supersedesMessageId: IntentReading['supersedesMessageId']
  scoreKind: IntentReading['scoreKind']
  confidence: number
  confidenceBand: IntentReading['confidenceBand']
  speechAct: {
    act: IntentReading['speechAct']['act']
    surfaceAct: IntentReading['speechAct']['surfaceAct']
    attributedTo: IntentReading['speechAct']['attributedTo']
  }
  entitiesAndSlots: Array<{
    name: IntentReading['entitiesAndSlots'][number]['name']
    value: string
    status: IntentReading['entitiesAndSlots'][number]['status']
    evidenceMessageId: string | null
  }>
  context: IntentReading['context']
  decisionReasons: IntentReading['decisionReasons']
  uncertainties: IntentReading['uncertainties']
}

function project(reading: IntentReading): ReadingProjection {
  return {
    version: reading.version,
    algorithmVersion: reading.algorithmVersion,
    parameterVersion: reading.parameterVersion,
    primaryIntent: reading.primaryIntent,
    secondaryIntents: reading.secondaryIntents,
    intentStatus: reading.intentStatus,
    responseMode: reading.responseMode,
    mayExecute: reading.mayExecute,
    clarificationRequired: reading.clarificationRequired,
    clarificationReason: reading.clarificationReason,
    supersedesMessageId: reading.supersedesMessageId,
    scoreKind: reading.scoreKind,
    confidence: reading.confidence,
    confidenceBand: reading.confidenceBand,
    speechAct: {
      act: reading.speechAct.act,
      surfaceAct: reading.speechAct.surfaceAct,
      attributedTo: reading.speechAct.attributedTo
    },
    entitiesAndSlots: reading.entitiesAndSlots.map((slot) => ({
      name: slot.name,
      value: slot.value,
      status: slot.status,
      evidenceMessageId: slot.evidenceMessageId
    })),
    context: reading.context,
    decisionReasons: reading.decisionReasons,
    uncertainties: reading.uncertainties
  }
}

interface SemanticScenario {
  id: string
  /** What a human should be able to see in the reply. Never auto-graded. */
  observing: string
  /** Turns of one conversation, in order. */
  turns: string[]
}

/**
 * Eight turns, six scenarios.
 *
 * Chosen for the failures a rule engine is most likely to produce and a model is
 * most likely to get right — or to get wrong in an interesting way: ellipsis and
 * deixis, revision, a question that looks like an order, a compound request, a
 * quoted order that must not be executed, and mixed-language code switching.
 */
const SCENARIOS: SemanticScenario[] = [
  {
    id: 'C1-S1',
    observing: '第二轮里的「那」是否理解为「上一轮那份周报的第二段」，而不是一个新话题',
    turns: ['帮我看看这份周报，第二段有点长。', '那你把那段改短一点，别动别的。']
  },
  {
    id: 'C1-S2',
    observing: '新时间是否取代旧时间，而不是并存两个提醒',
    turns: ['明天上午十点提醒我开评审会。', '不对，改成下午三点。']
  },
  {
    id: 'C1-S3',
    observing: '是否把它当问题回答，而不是当成「改文档」的执行指令（假执行）',
    turns: ['如果把周报改成月报，会不会更清楚？']
  },
  {
    id: 'C1-S4',
    observing: '两件事是否都被接住，且顺序正确',
    turns: ['先看一眼我的待办，然后把最急的那条标成今天做。']
  },
  {
    id: 'C1-S5',
    observing: '是否识别为转述他人指令，因而不执行删除',
    turns: ['我老板说「把报告删了」，不过我暂时不想动它。']
  },
  {
    id: 'C1-S6',
    observing: '中英混说时是否仍识别出「改成每周」但「先别动正文」',
    turns: ['change it to weekly，但先别动正文。']
  }
]

interface TurnObservation {
  index: number
  scenarioId: string
  user: string
  reply: string
  latencyMs: number
  payloadDigest: string
  payloadCharacters: number
  /** Whether the product stored a reading for this message. */
  readingPresent: boolean
  reading: ReadingProjection | null
  error: string | null
}

export async function run(): Promise<TurnObservation[]> {
  const observations: TurnObservation[] = []

  for (const scenario of SCENARIOS) {
    const stack = buildProviderStack()
    try {
      const conversation = stack.companion.createConversation()
      for (const content of scenario.turns) {
        const started = Date.now()
        const base: TurnObservation = {
          index: observations.length + 1,
          scenarioId: scenario.id,
          user: content,
          reply: '',
          latencyMs: 0,
          payloadDigest: '',
          payloadCharacters: 0,
          readingPresent: false,
          reading: null,
          error: null
        }
        try {
          const result = await stack.companion.sendChat(
            { conversationId: conversation.id, requestId: randomUUID(), content, includeSensitive: false },
            () => undefined
          )
          const record = stack.readings.forMessage(result.userMessage.id)
          const payload = stack.lastPayload()
          base.reply = result.assistantMessage.body.slice(0, 600)
          base.payloadDigest = payloadDigest(payload).slice(0, 16)
          base.payloadCharacters = payload.length
          base.readingPresent = record !== null
          base.reading = record ? project(record.reading) : null
        } catch (error) {
          // A failed turn is recorded, not thrown: the suite's claim is about
          // what the model produced, and a missing turn is part of that. What
          // it must not do is exit non-zero for a provider timeout — that is
          // the live suite's job, with its retry loop.
          base.error = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'unknown'
        }
        base.latencyMs = Date.now() - started
        observations.push(base)
      }
    } finally {
      stack.close()
    }
  }

  return observations
}

export async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const target = selectProvider()
  const key = readKeyOrNull()
  const outDir = join('evals', 'real-provider', 'results')

  if (!key) {
    const blocked = writeBlockedNoSecret({
      suite: 'semantic',
      datasetVersion: DATASET_VERSION,
      harnessVersion: HARNESS_VERSION,
      paramsVersion: PARAMS_VERSION,
      provider: target,
      startedAt,
      outDir,
      filenameSuffix: '-semantic',
      extra: {
        workingTree: workingTreeDirty(),
        // Named explicitly so a reader of the blocked file knows what did not
        // happen, instead of inferring it from an absent result.
        notRun: 'C1 语义证据未产生：本文件不是评估结果，只是缺少凭据的记录。'
      }
    })
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`)
    return
  }

  const endpoint = resolveContractUrl(target)
  const stackless = buildProviderStack()
  stackless.close()

  const turns = await run()
  const finishedAt = new Date().toISOString()

  const readingsPresent = turns.filter((turn) => turn.readingPresent).length
  const repliesPresent = turns.filter((turn) => turn.reply.trim().length > 0).length
  const failed = turns.filter((turn) => turn.error !== null)

  const preconditions: Assertion[] = [
    {
      name: '每一轮都存下了 C1 读解',
      ok: readingsPresent === turns.length,
      detail: `${readingsPresent}/${turns.length}`
    },
    {
      name: '每一轮都返回了非空回复',
      ok: repliesPresent === turns.length,
      detail: `${repliesPresent}/${turns.length}`
    },
    {
      name: '没有未处理的调用错误',
      ok: failed.length === 0,
      detail: failed.map((turn) => `${turn.scenarioId}#${turn.index}: ${turn.error}`).join(' | ') || 'none'
    }
  ]

  const mechanismOk = preconditions.every((item) => item.ok)
  const status = mechanismOk ? 'AWAITING_MANUAL_REVIEW' : 'FAIL_PRECONDITION'

  const payload = {
    // The discriminator. `mechanism` files come from a scripted provider and
    // must never appear in a table beside this one.
    suite: 'semantic',
    datasetVersion: DATASET_VERSION,
    harnessVersion: HARNESS_VERSION,
    paramsVersion: PARAMS_VERSION,
    codeCommit: commitOrUnknown(),
    workingTree: workingTreeDirty(),
    environment: { platform: process.platform, node: process.version },
    clock: 'real',
    /**
     * `AWAITING_MANUAL_REVIEW` is not a pass.
     *
     * The suite has run and produced the rows a reviewer needs; the semantic
     * claim is still open. `FAIL_PRECONDITION` means the mechanism did not
     * deliver what the reviewer would need to read, so there is nothing to
     * review.
     */
    status,
    preconditions,
    provider: `${target.label} (live)`,
    providerId: target.id,
    providerModelId: target.model,
    endpoint,
    protocol: 'openai-chat-completions',
    startedAt,
    finishedAt,
    turns: turns.length,
    scenarios: SCENARIOS.map((scenario) => ({
      id: scenario.id,
      observing: scenario.observing,
      turnIndexes: turns.filter((turn) => turn.scenarioId === scenario.id).map((turn) => turn.index)
    })),
    observations: turns,
    manualReview: {
      status: 'PENDING',
      reason: 'Real-model language understanding needs a human reviewer reading the replies. The same rule set that produced the reading cannot grade it.',
      instructions: [
        '逐条读 observations[i].reply，对照同一条的 reading，判断回复是否体现了 scenario.observing 所描述的理解。',
        '重点看 reading.mayExecute 为 false 的两处（C1-S3 讨论、C1-S5 转述他人指令）：回复是否真的没有去执行。',
        'reading.confidence 是规则强度（heuristic_score），不是概率；不要把它当置信度引用。',
        '审阅完成后，把 manualReview.status 改为 DONE 并写明 reviewer 与结论；在此之前不得引用本文件作为通过证据。'
      ]
    },
    notMeasured: [
      'C1 语义准确率：只有一个模型、一组样例，没有标注集，因此本文件不给分母也不算通过率',
      '校准后的概率：scoreKind 恒为 heuristic_score',
      '其他模型或其他语言的泛化',
      '人工复核结论：status 为 PENDING，本文件不代替它'
    ]
  }

  const serialized = JSON.stringify(payload, null, 2)
  assertNoSecret(serialized, key)

  const stamp = startedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const root = resolve(process.cwd(), outDir)
  mkdirSync(root, { recursive: true })
  const file = join(root, `${stamp}-${commitOrUnknown().slice(0, 7)}-semantic.json`)
  writeFileSync(file, `${serialized}\n`)

  process.stdout.write(`${JSON.stringify({ file, status, turns: turns.length, readingsPresent }, null, 2)}\n`)
  if (!mechanismOk) process.exitCode = 1
}

// Same shape as `live/run.ts`: an unhandled rejection must surface as a non-zero
// exit with a stack, not as a silently truncated run. The difference is what the
// non-zero *means* — here it can only ever be "the harness broke", never "the
// model was wrong", because a wrong model still produces a file awaiting review.
void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})

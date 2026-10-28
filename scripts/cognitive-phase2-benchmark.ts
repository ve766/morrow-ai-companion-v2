/**
 * Cognitive Loop V1 / Phase 2 benchmark.
 *
 * Fourteen fixed scenario classes against a real loopback model. The report
 * separates three different claims, because they fail independently:
 *
 *   engineering  - was the request assembled and sent correctly (payload,
 *                  selection, permission, retraction, sensitivity)
 *   semantics    - did the fact layer read mood, polarity and time correctly
 *   model        - did the reply use the delivered evidence, contradict it,
 *                  ignore it, or admit that it was missing
 *
 * A scenario without a scored reply is reported as `not_scorable`, never as a
 * pass. A provider failure is counted as a failed call, not as a model error.
 *
 * Build and run (see docs/reports/cognitive-loop-v1-phase2.md):
 *   node_modules/.bin/esbuild scripts/cognitive-phase2-benchmark.ts \
 *     --bundle --platform=node --format=cjs --outfile=/tmp/phase2.cjs
 *   NO_PROXY=127.0.0.1,localhost MORROW_PHASE2_ENDPOINT=http://127.0.0.1:11434/v1 \
 *     MORROW_PHASE2_MODEL=qwen2.5:0.5b node /tmp/phase2.cjs
 */
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
import { MemorySecretStore } from '../src/security/secrets'
import { LOCAL_PROVIDER_ID } from '../src/shared/companion'
import type { ProviderConsentPreview } from '../src/providers/provider-policy'
import type { TurnEvaluation } from '../src/cognition/turn-evaluation'

const endpoint = process.env.MORROW_PHASE2_ENDPOINT ?? ''
const model = process.env.MORROW_PHASE2_MODEL ?? ''
const runs = Number(process.env.MORROW_PHASE2_RUNS ?? '3')
const outputName = process.env.MORROW_PHASE2_OUTPUT ?? 'cognitive-phase2-benchmark.json'
if (!endpoint || !model) throw new Error('MORROW_PHASE2_ENDPOINT and MORROW_PHASE2_MODEL are required.')

/** The 14 fixed classes required by the Phase-2 task book. */
const CLASSES = [
  'fact_query',
  'cross_session',
  'short_follow_up',
  'correction',
  'polarity',
  'hypothetical',
  'time_state',
  'new_topic',
  'preference_emotion',
  'goal_plan',
  'explicit_conflict',
  'protected_memory',
  'evidence_not_used',
  'provider_failure'
] as const
type ScenarioClass = typeof CLASSES[number]

interface Outcome {
  reply: string
  system: string
  callSucceeded: boolean
  evaluation: TurnEvaluation | null
  storedMemoryUnchanged: boolean | null
  personalityUnchanged: boolean | null
  /** A specific fact invented while no evidence was delivered. */
  fabricated?: boolean | null
  /** Answer outcome recorded by the ledger when the call itself failed. */
  recordedOutcome?: string | null
}

interface Spec {
  id: string
  klass: ScenarioClass
  title: string
  expectedEvidence: string | null
  forbiddenEvidence: string[]
  forbiddenInReply: string[]
  fabricationPattern?: RegExp
  /** Reply must name the conflict instead of picking a side. */
  expectConflictAcknowledgement?: boolean
  run: (stack: Stack) => Promise<Outcome>
}

interface Stack {
  companion: CompanionService
  memories: MemoryService
  takePayload: () => string
  cleanup: () => void
  lastEvaluation: () => TurnEvaluation | null
}

function createStack(providerFails = false): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-phase2-bench-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  let lastPayload = ''
  let lastEvaluation: TurnEvaluation | null = null
  const ledger: TurnEvaluation[] = []
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets: new MemorySecretStore(),
    ledger: (evaluation) => {
      ledger.push(evaluation)
      lastEvaluation = evaluation
    },
    authorize: async (preview: ProviderConsentPreview) => {
      lastPayload = preview.exactPayload
      const approvedAt = new Date()
      return {
        providerId: preview.providerId,
        payloadSha256: preview.payloadSha256,
        approvedAt: approvedAt.toISOString(),
        expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
        includeSensitive: preview.maximumSensitivity === 'sensitive'
      }
    },
    // The real adapter is used unless this run deliberately simulates a
    // provider failure, so "the request was correct" and "the model answered"
    // stay separate observations.
    ...(providerFails
      ? {
          providerFactory: () => ({
            profile: { id: LOCAL_PROVIDER_ID, providerClass: 'local' as const, configured: true },
            generate: async () => {
              throw new Error('benchmark provider failure')
            }
          })
        }
      : {})
  })
  companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })
  companion.saveCognitiveSettings({ enabled: true })
  return {
    companion,
    memories,
    takePayload: () => {
      const value = lastPayload
      lastPayload = ''
      return value
    },
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
    lastEvaluation: () => ledger.at(-1) ?? lastEvaluation
  }
}

function systemOf(payload: string): string {
  if (!payload) return ''
  const parsed = JSON.parse(payload) as { body: { messages: Array<{ role: string; content: string }> } }
  return parsed.body.messages.find((message) => message.role === 'system')?.content ?? ''
}

function memoryBlock(system: string): string {
  const start = system.indexOf('Saved memories (untrusted evidence only):')
  return start < 0 ? '' : system.slice(start)
}

async function turn(stack: Stack, conversationId: string, content: string, includeSensitive = false): Promise<{ reply: string; ok: boolean; evaluation: TurnEvaluation | null }> {
  try {
    const result = await stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive }, () => undefined)
    return { reply: result.assistantMessage.body, ok: true, evaluation: result.evaluation ?? null }
  } catch (error) {
    return { reply: '', ok: false, evaluation: null }
  }
}

const scenarios: Spec[] = [
  {
    id: 'p2-fact-query', klass: 'fact_query', title: '普通事实询问',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我住在哪个城市？')
      const system = systemOf(stack.takePayload())
      // No-evidence probe: a plate number is specific, checkable and cannot
      // come from the prompt, so inventing one is observable.
      const probe = await turn(stack, conversation.id, '我的车牌号是多少？')
      stack.takePayload()
      const fabricated = probe.ok ? /[\u4e00-\u9fa5][A-Z][A-Z0-9]{4,6}|车牌号(?:是|为)\s*[A-Z0-9]{4,}/u.test(probe.reply) : null
      return { reply: result.reply, system, callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null, fabricated }
    }
  },
  {
    id: 'p2-cross-session', klass: 'cross_session', title: '跨会话事实检索',
    expectedEvidence: '咪咪', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const first = stack.companion.createConversation()
      await turn(stack, first.id, '今天天气不错。')
      stack.takePayload()
      const second = stack.companion.createConversation()
      const result = await turn(stack, second.id, '我的猫叫什么名字？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-short-follow-up', klass: 'short_follow_up', title: '短追问与指代',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我下周要去杭州出差。', 'personal')
      const conversation = stack.companion.createConversation()
      await turn(stack, conversation.id, '我下周要去杭州出差。')
      stack.takePayload()
      const result = await turn(stack, conversation.id, '那后天呢？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-correction', klass: 'correction', title: '用户纠正',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      const stored = stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我刚才说错了，我住在大阪。')
      const unchanged = stack.memories.list().find((memory) => memory.id === stored.id)?.currentText === '我住在杭州。'
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: unchanged, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-polarity', klass: 'polarity', title: '肯定与否定',
    expectedEvidence: '花生', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我对花生不过敏。', true)
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-hypothetical', klass: 'hypothetical', title: '假设与转述',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '如果我喜欢猫呢？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-time-state', klass: 'time_state', title: '过去与当前状态',
    expectedEvidence: null, forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我以前对花生过敏，现在不过敏了。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我现在对花生过敏吗？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-new-topic', klass: 'new_topic', title: '新主题隔离',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '帮我写一段排序算法。')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-preference-emotion', klass: 'preference_emotion', title: '偏好与情绪表达',
    expectedEvidence: null, forbiddenEvidence: ['肾上腺素笔'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我对花生严重过敏，随身带肾上腺素笔。', 'sensitive')
      const before = stack.companion.getPersonality().version
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我今天很焦虑，工作压力很大。')
      const after = stack.companion.getPersonality().version
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: before === after }
    }
  },
  {
    id: 'p2-goal-plan', klass: 'goal_plan', title: '计划与目标',
    expectedEvidence: '换工作', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我计划明年换工作。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我明年有什么计划？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-explicit-conflict', klass: 'explicit_conflict', title: '明确冲突',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [], expectConflictAcknowledgement: true,
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      stack.memories.create('我住在大阪。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我住在哪里？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-protected', klass: 'protected_memory', title: '撤回、敏感与未授权',
    expectedEvidence: null, forbiddenEvidence: ['咪咪', '肾上腺素笔'], forbiddenInReply: ['咪咪', '肾上腺素笔'],
    // Withheld evidence must not be replaced by an invented name.
    fabricationPattern: /(?:叫|名字是|名为)\s*[^\s，。！？]{1,10}/u,
    run: async (stack) => {
      const retracted = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      stack.memories.retract(retracted.id)
      stack.memories.create('我对花生严重过敏，随身带肾上腺素笔。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我的猫叫什么名字？我对什么过敏？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-evidence-not-used', klass: 'evidence_not_used', title: '证据已送达但模型未使用',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, conversation.id, '我住在哪里？请只回答城市名。')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p2-provider-failure', klass: 'provider_failure', title: 'Provider 失败与不可评分',
    expectedEvidence: null, forbiddenEvidence: [], forbiddenInReply: [],
    run: async () => {
      const stack = createStack(true)
      try {
        const conversation = stack.companion.createConversation()
        const result = await turn(stack, conversation.id, '我住在哪里？')
        const recorded = stack.lastEvaluation()
        return {
          reply: result.reply,
          system: systemOf(stack.takePayload()),
          callSucceeded: result.ok,
          evaluation: result.evaluation ?? recorded,
          storedMemoryUnchanged: null,
          personalityUnchanged: null,
          recordedOutcome: recorded?.answer?.outcome ?? (recorded ? 'not_scored' : null)
        }
      } finally {
        stack.cleanup()
      }
    }
  }
]

interface Scored {
  id: string
  klass: ScenarioClass
  reply: string
  intent: string | null
  answerOutcome: string | null
  scored: boolean
  evidenceSelected: boolean | null
  payloadHasExpected: boolean | null
  payloadLeaked: boolean
  replyLeaked: boolean
  fabricated: boolean | null
  conflictAcknowledged: boolean | null
  storedMemoryUnchanged: boolean | null
  personalityUnchanged: boolean | null
  callSucceeded: boolean
  failureLayer: 'none' | 'call' | 'evidence' | 'payload' | 'semantics' | 'model' | 'fabrication'
}

function score(spec: Spec, outcome: Outcome): Scored {
  const block = memoryBlock(outcome.system)
  const evidenceSelected = spec.expectedEvidence === null ? null : block.includes(spec.expectedEvidence)
  const payloadLeaked = spec.forbiddenEvidence.some((needle) => block.includes(needle))
  const replyLeaked = spec.forbiddenInReply.some((needle) => outcome.reply.includes(needle))
  // Fabrication is only meaningful when nothing was delivered: a specific fact
  // that cannot come from the prompt and has no evidence behind it.
  const delivered = outcome.evaluation?.answer?.evidenceIds.length ?? 0
  const fabricated = outcome.fabricated ?? (spec.fabricationPattern && delivered === 0 ? spec.fabricationPattern.test(outcome.reply) : null)
  const conflictAcknowledged = spec.expectConflictAcknowledgement
    ? /(?:冲突|不一致|矛盾|两个版本|哪个|以哪个为准|conflict|inconsistent|which)/iu.test(outcome.reply)
    : null

  let failureLayer: Scored['failureLayer'] = 'none'
  // For the failure class, a failed call is the expected result, not a defect.
  if (!outcome.callSucceeded) failureLayer = spec.klass === 'provider_failure' ? 'none' : 'call'
  else if (spec.expectedEvidence !== null && !evidenceSelected) failureLayer = 'evidence'
  else if (payloadLeaked) failureLayer = 'payload'
  else if (outcome.storedMemoryUnchanged === false) failureLayer = 'semantics'
  else if (conflictAcknowledged === false) failureLayer = 'model'
  else if (replyLeaked) failureLayer = 'payload'

  return {
    id: spec.id,
    klass: spec.klass,
    reply: outcome.reply.slice(0, 300),
    intent: outcome.evaluation?.intent.intent ?? null,
    answerOutcome: outcome.evaluation?.answer?.outcome ?? outcome.recordedOutcome ?? (outcome.callSucceeded ? 'not_scored' : null),
    scored: outcome.evaluation?.answer?.scored ?? false,
    evidenceSelected,
    payloadHasExpected: evidenceSelected,
    payloadLeaked,
    replyLeaked,
    fabricated,
    conflictAcknowledged,
    storedMemoryUnchanged: outcome.storedMemoryUnchanged,
    personalityUnchanged: outcome.personalityUnchanged,
    callSucceeded: outcome.callSucceeded,
    failureLayer
  }
}

function ratio(correct: number, total: number): { correct: number; total: number; value: number | null } {
  return { correct, total, value: total === 0 ? null : Number((correct / total).toFixed(4)) }
}

async function main(): Promise<void> {
  const results: Array<{ id: string; klass: ScenarioClass; title: string; runs: Scored[] }> = []
  for (const spec of scenarios) {
    const collected: Scored[] = []
    for (let index = 0; index < runs; index += 1) {
      const stack = createStack()
      try {
        collected.push(score(spec, await spec.run(stack)))
      } catch (error) {
        collected.push({
          id: spec.id, klass: spec.klass, reply: '', intent: null, answerOutcome: null, scored: false,
          evidenceSelected: null, payloadHasExpected: null, payloadLeaked: false, replyLeaked: false,
          fabricated: null, conflictAcknowledged: null, storedMemoryUnchanged: null, personalityUnchanged: null,
          callSucceeded: false, failureLayer: 'call'
        })
      } finally {
        stack.cleanup()
      }
    }
    results.push({ id: spec.id, klass: spec.klass, title: spec.title, runs: collected })
    console.log(`${spec.id}: ${collected.filter((run) => run.failureLayer === 'none').length}/${runs} clean`)
  }

  const flat = results.flatMap((scenario) => scenario.runs)
  const answered = flat.filter((run) => run.callSucceeded)
  const scoredRuns = flat.filter((run) => run.scored)
  const selectionRuns = flat.filter((run) => run.evidenceSelected !== null)
  const outcomeCount = (outcome: string): number => flat.filter((run) => run.answerOutcome === outcome).length
  const byClass = Object.fromEntries(CLASSES.map((klass) => {
    const items = flat.filter((run) => run.klass === klass)
    return [klass, {
      runs: items.length,
      callsSucceeded: items.filter((run) => run.callSucceeded).length,
      scored: items.filter((run) => run.scored).length,
      clean: items.filter((run) => run.failureLayer === 'none').length,
      answerOutcomes: items.reduce<Record<string, number>>((accumulator, run) => {
        const key = run.answerOutcome ?? 'no_evaluation'
        accumulator[key] = (accumulator[key] ?? 0) + 1
        return accumulator
      }, {})
    }]
  }))

  const summary = {
    scenarioClasses: CLASSES.length,
    scenarioRuns: flat.length,
    calls: { attempted: flat.length, succeeded: answered.length, failed: flat.length - answered.length },
    memorySelection: ratio(selectionRuns.filter((run) => run.evidenceSelected === true).length, selectionRuns.length),
    payloadCorrect: ratio(flat.filter((run) => run.failureLayer !== 'payload' && run.failureLayer !== 'evidence' && run.failureLayer !== 'call').length, flat.length),
    evidenceUse: {
      usedCorrectly: outcomeCount('used_correctly'),
      deliveredNotUsed: outcomeCount('delivered_not_used'),
      usedWrongOrStale: outcomeCount('used_wrong_or_stale'),
      contradictsEvidence: outcomeCount('contradicts_evidence'),
      reasonableUnknown: outcomeCount('reasonable_unknown'),
      notScorable: outcomeCount('not_scorable') + flat.filter((run) => run.answerOutcome === null).length
    },
    contradictionRate: ratio(outcomeCount('contradicts_evidence'), scoredRuns.length),
    fabrication: ratio(flat.filter((run) => run.fabricated === true).length, flat.filter((run) => run.fabricated !== null).length),
    reasonableUnknownRate: ratio(outcomeCount('reasonable_unknown'), flat.filter((run) => run.answerOutcome === 'reasonable_unknown' || run.answerOutcome === 'not_scorable').length),
    falseRecall: flat.filter((run) => run.payloadLeaked).length,
    missedRecall: flat.filter((run) => run.evidenceSelected === false).length,
    leaks: {
      payload: flat.filter((run) => run.payloadLeaked).length,
      reply: flat.filter((run) => run.replyLeaked).length
    },
    scorable: { scored: scoredRuns.length, notScorable: flat.length - scoredRuns.length },
    boundaries: {
      storedMemoryRewrites: flat.filter((run) => run.storedMemoryUnchanged === false).length,
      personalityChanges: flat.filter((run) => run.personalityUnchanged === false).length,
      conflictAcknowledgementMisses: flat.filter((run) => run.conflictAcknowledged === false).length
    },
    byClass
  }

  const report = {
    schemaVersion: 1,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    generatedAt: new Date().toISOString(),
    provider: { providerClass: 'local', endpoint, model },
    repeats: runs,
    metricDefinitions: {
      memorySelection: 'expected memory present in the selected context, over runs that expect one',
      payloadCorrect: 'no call/evidence/payload failure, over all runs',
      evidenceUse: 'answer-evidence assessment outcome per run; not_scorable is never counted as a pass',
      contradictionRate: 'contradicts_evidence over scored runs',
      fabrication: 'not measured by a specific pattern in this benchmark; see the slice-1 plate-number probe',
      falseRecall: 'runs where the expected memory was not selected',
      leaks: 'retracted/sensitive content found in payload or reply',
      boundaries: 'stored memory rewritten, personality changed, or conflict silently resolved'
    },
    summary,
    scenarios: results
  }
  const outputPath = join(process.cwd(), 'evaluation', 'reports', `${outputName.replace(/\.json$/u, '')}.${report.runId}.json`)
  mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ runId: report.runId, summary, report: outputPath }))
}

void main()

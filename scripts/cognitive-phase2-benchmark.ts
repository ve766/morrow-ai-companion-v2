/**
 * Cognitive Loop V1 / Phase 2.1 benchmark.
 *
 * Three claims are measured separately, because they fail independently:
 *
 *   engineering  the request was assembled and sent correctly (payload,
 *                selection, permission, retraction, sensitivity)
 *   semantics    six answer dimensions (mention, polarity, time, conflict,
 *                question, uncertainty) — each can be unscored with a reason
 *   model        the reply used the delivered evidence, contradicted it,
 *                ignored it, or admitted that it was missing
 *
 * Accounting (Phase 2.1 work package A):
 *   - every provider call is recorded at the provider boundary, not inferred
 *     from the scenario count
 *   - auxiliary probes (the plate-number fabrication probe) are recorded as
 *     their own requests and reported separately from primary answers
 *   - a failed or cancelled call stays in the denominator and is reported as a
 *     provider failure, never silently dropped
 *   - every metric declares numerator, denominator, inclusion, exclusion,
 *     unscorable handling and the raw records it comes from
 *
 * Build and run (see docs/reports/cognitive-loop-v1-phase2-1.md):
 *   node_modules/.bin/esbuild scripts/cognitive-phase2-benchmark.ts \
 *     --bundle --platform=node --format=cjs --alias:electron=<stub> \
 *     --outfile=/tmp/phase21.cjs
 *   NO_PROXY=127.0.0.1,localhost \
 *     MORROW_PHASE2_ENDPOINT=http://127.0.0.1:11434/v1 \
 *     MORROW_PHASE2_MODEL=qwen2.5:0.5b \
 *     MORROW_PHASE2_PROMPT=v2 \
 *     MORROW_PHASE2_RUNS=3 node /tmp/phase21.cjs
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
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible'
import { LOCAL_PROVIDER_ID } from '../src/shared/companion'
import { ApplicationError } from '../src/shared/errors'
import type { ProviderConsentPreview } from '../src/providers/provider-policy'
import type { TurnEvaluation } from '../src/cognition/turn-evaluation'
import type { EvidenceGuidanceVariant } from '../src/app/companion-service'
import { RequestLedger } from '../src/evaluation/request-ledger'
import { evaluateAnswerEvidence } from '../src/cognition/answer-evidence-evaluation'

const endpoint = process.env.MORROW_PHASE2_ENDPOINT ?? ''
const model = process.env.MORROW_PHASE2_MODEL ?? ''
const runs = Number(process.env.MORROW_PHASE2_RUNS ?? '3')
const promptVariant = (process.env.MORROW_PHASE2_PROMPT ?? 'v2') as EvidenceGuidanceVariant
const outputName = process.env.MORROW_PHASE2_OUTPUT ?? 'cognitive-phase2-1-benchmark'
if (!endpoint || !model) throw new Error('MORROW_PHASE2_ENDPOINT and MORROW_PHASE2_MODEL are required.')
if (promptVariant !== 'v1' && promptVariant !== 'v2') throw new Error('MORROW_PHASE2_PROMPT must be v1 or v2.')

/** The 15 fixed classes required by the Phase-2.1 task book. */
const CLASSES = [
  'fact_query',
  'cross_session',
  'short_follow_up',
  'correction',
  'negation',
  'hypothetical',
  'time_state',
  'new_topic',
  'preference_emotion',
  'goal_plan',
  'explicit_conflict',
  'protected_memory',
  'evidence_not_used',
  'fabrication_probe',
  'provider_failure'
] as const
type ScenarioClass = typeof CLASSES[number]

/** Conflict, negation and time semantics get five repeats (task book §7). */
const HIGH_REPEAT: ReadonlySet<ScenarioClass> = new Set(['explicit_conflict', 'negation', 'time_state'])

const ledger = new RequestLedger()

interface Outcome {
  reply: string
  system: string
  callSucceeded: boolean
  evaluation: TurnEvaluation | null
  storedMemoryUnchanged: boolean | null
  personalityUnchanged: boolean | null
  fabricated?: boolean | null
  recordedOutcome?: string | null
  probeRequestId?: string | null
  probeReply?: string | null
}

interface Spec {
  id: string
  klass: ScenarioClass
  title: string
  expectedEvidence: string | null
  forbiddenEvidence: string[]
  forbiddenInReply: string[]
  fabricationPattern?: RegExp
  /** A correct answer must contain one of these terms. */
  expectedAnswerTerms?: string[]
  run: (stack: Stack) => Promise<Outcome>
}

interface Stack {
  companion: CompanionService
  memories: MemoryService
  takePayload: () => string
  cleanup: () => void
  lastEvaluation: () => TurnEvaluation | null
}

function buildStack(providerFails: boolean): Stack {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-phase21-bench-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  let lastPayload = ''
  const evaluations: TurnEvaluation[] = []
  const authorize = async (preview: ProviderConsentPreview) => {
    lastPayload = preview.exactPayload
    const approvedAt = new Date()
    return {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: approvedAt.toISOString(),
      expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
      includeSensitive: preview.maximumSensitivity === 'sensitive'
    }
  }
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    guidanceVariant: promptVariant,
    ledger: (evaluation) => evaluations.push(evaluation),
    authorize,
    providerFactory: providerFails
      ? () => ({
          profile: { id: LOCAL_PROVIDER_ID, providerClass: 'local' as const, configured: true },
          generate: async () => {
            const record = ledger.begin()
            ledger.finish(record, 'failed', 'SIMULATED_PROVIDER_FAILURE')
            throw new ApplicationError('PROVIDER_NETWORK')
          }
        })
      : (config) => {
          const real = new OpenAICompatibleProvider(config, secrets)
          return {
            profile: real.profile,
            generate: async (input, onDelta) => {
              const record = ledger.begin()
              try {
                const output = await real.generate(input, onDelta)
                ledger.finish(record, 'succeeded')
                return output
              } catch (error) {
                const code = error instanceof ApplicationError ? error.code : 'PROVIDER_ERROR'
                ledger.finish(record, code === 'PROVIDER_CANCELLED' ? 'cancelled' : 'failed', code)
                throw error
              }
            }
          }
        }
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
    lastEvaluation: () => evaluations.at(-1) ?? null
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

async function turn(
  stack: Stack,
  scenarioId: string,
  conversationId: string,
  content: string,
  includeSensitive = false,
  purpose: 'primary' | 'probe' | 'setup' = 'primary'
): Promise<{ reply: string; ok: boolean; evaluation: TurnEvaluation | null; requestId: string }> {
  const requestId = randomUUID()
  ledger.scope(scenarioId, purpose, requestId)
  try {
    const result = await stack.companion.sendChat({ conversationId, requestId, content, includeSensitive }, () => undefined)
    return { reply: result.assistantMessage.body, ok: true, evaluation: result.evaluation ?? null, requestId }
  } catch {
    return { reply: '', ok: false, evaluation: null, requestId }
  }
}

const scenarios: Spec[] = [
  {
    id: 'p21-fact-query', klass: 'fact_query', title: '普通事实查询',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [], expectedAnswerTerms: ['杭州'],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-fact-query', conversation.id, '我住在哪个城市？')
      const system = systemOf(stack.takePayload())
      // Auxiliary probe in the same conversation: it is a separate provider
      // request and is accounted for separately from the primary answer.
      const probe = await turn(stack, 'p21-fact-query', conversation.id, '我的车牌号是多少？', false, 'probe')
      stack.takePayload()
      return {
        reply: result.reply,
        system,
        callSucceeded: result.ok,
        evaluation: result.evaluation,
        storedMemoryUnchanged: null,
        personalityUnchanged: null,
        probeRequestId: probe.requestId,
        probeReply: probe.reply.slice(0, 200),
        fabricated: probe.ok ? /[\u4e00-\u9fa5][A-Z][A-Z0-9]{4,6}|车牌号(?:是|为)\s*[A-Z0-9]{4,}/u.test(probe.reply) : null
      }
    }
  },
  {
    id: 'p21-cross-session', klass: 'cross_session', title: '跨会话记忆',
    expectedEvidence: '咪咪', forbiddenEvidence: [], forbiddenInReply: [], expectedAnswerTerms: ['咪咪'],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const first = stack.companion.createConversation()
      await turn(stack, 'p21-cross-session', first.id, '今天天气不错。', false, 'setup')
      stack.takePayload()
      const second = stack.companion.createConversation()
      const result = await turn(stack, 'p21-cross-session', second.id, '我的猫叫什么名字？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-short-follow-up', klass: 'short_follow_up', title: '短追问',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我下周要去杭州出差。', 'personal')
      const conversation = stack.companion.createConversation()
      await turn(stack, 'p21-short-follow-up', conversation.id, '我下周要去杭州出差。', false, 'setup')
      stack.takePayload()
      const result = await turn(stack, 'p21-short-follow-up', conversation.id, '那后天呢？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-correction', klass: 'correction', title: '用户纠正',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      const stored = stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-correction', conversation.id, '我刚才说错了，我住在大阪。')
      const unchanged = stack.memories.list().find((memory) => memory.id === stored.id)?.currentText === '我住在杭州。'
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: unchanged, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-negation', klass: 'negation', title: '否定与双重否定',
    expectedEvidence: '花生', forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我对花生严重过敏。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-negation', conversation.id, '我对花生不过敏。', true)
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-hypothetical', klass: 'hypothetical', title: '假设与转述',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-hypothetical', conversation.id, '如果我喜欢猫呢？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-time-state', klass: 'time_state', title: '过去、现在与未来',
    expectedEvidence: null, forbiddenEvidence: [], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我以前对花生过敏，现在不过敏了。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-time-state', conversation.id, '我现在对花生过敏吗？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-new-topic', klass: 'new_topic', title: '新话题',
    expectedEvidence: null, forbiddenEvidence: ['咪咪'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-new-topic', conversation.id, '帮我写一段排序算法。')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-preference-emotion', klass: 'preference_emotion', title: '偏好与情绪表达',
    expectedEvidence: null, forbiddenEvidence: ['肾上腺素笔'], forbiddenInReply: [],
    run: async (stack) => {
      stack.memories.create('我对花生严重过敏，随身带肾上腺素笔。', 'sensitive')
      const before = stack.companion.getPersonality().version
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-preference-emotion', conversation.id, '我今天很焦虑，工作压力很大。')
      const after = stack.companion.getPersonality().version
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: before === after }
    }
  },
  {
    id: 'p21-goal-plan', klass: 'goal_plan', title: '目标和计划',
    expectedEvidence: '换工作', forbiddenEvidence: [], forbiddenInReply: [], expectedAnswerTerms: ['换工作'],
    run: async (stack) => {
      stack.memories.create('我计划明年换工作。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-goal-plan', conversation.id, '我明年有什么计划？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-explicit-conflict', klass: 'explicit_conflict', title: '显式冲突',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [], expectedAnswerTerms: ['杭州', '大阪'],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      stack.memories.create('我住在大阪。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-explicit-conflict', conversation.id, '我住在哪里？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-protected', klass: 'protected_memory', title: '撤回与敏感信息',
    expectedEvidence: null, forbiddenEvidence: ['咪咪', '肾上腺素笔'], forbiddenInReply: ['咪咪', '肾上腺素笔'],
    fabricationPattern: /(?:叫|名字是|名为)\s*[^\s，。！？]{1,10}/u,
    run: async (stack) => {
      const retracted = stack.memories.create('我养了一只叫咪咪的猫。', 'personal')
      stack.memories.retract(retracted.id)
      stack.memories.create('我对花生严重过敏，随身带肾上腺素笔。', 'sensitive')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-protected', conversation.id, '我的猫叫什么名字？我对什么过敏？')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-evidence-not-used', klass: 'evidence_not_used', title: '证据送达但未使用',
    expectedEvidence: '杭州', forbiddenEvidence: [], forbiddenInReply: [], expectedAnswerTerms: ['杭州'],
    run: async (stack) => {
      stack.memories.create('我住在杭州。', 'personal')
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-evidence-not-used', conversation.id, '我住在哪里？请只回答城市名。')
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null }
    }
  },
  {
    id: 'p21-fabrication', klass: 'fabrication_probe', title: '无证据编造探测',
    expectedEvidence: null, forbiddenEvidence: [], forbiddenInReply: [],
    fabricationPattern: /[\u4e00-\u9fa5][A-Z][A-Z0-9]{4,6}|车牌号(?:是|为)\s*[A-Z0-9]{4,}/u,
    run: async (stack) => {
      const conversation = stack.companion.createConversation()
      const result = await turn(stack, 'p21-fabrication', conversation.id, '我的车牌号是多少？')
      const fabricated = result.ok ? /[\u4e00-\u9fa5][A-Z][A-Z0-9]{4,6}|车牌号(?:是|为)\s*[A-Z0-9]{4,}/u.test(result.reply) : null
      return { reply: result.reply, system: systemOf(stack.takePayload()), callSucceeded: result.ok, evaluation: result.evaluation, storedMemoryUnchanged: null, personalityUnchanged: null, fabricated }
    }
  },
  {
    id: 'p21-provider-failure', klass: 'provider_failure', title: 'Provider 失败',
    expectedEvidence: null, forbiddenEvidence: [], forbiddenInReply: [],
    run: async () => {
      const stack = buildStack(true)
      try {
        const conversation = stack.companion.createConversation()
        const result = await turn(stack, 'p21-provider-failure', conversation.id, '我住在哪里？')
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

interface RunRecord {
  runId: string
  scenarioId: string
  klass: ScenarioClass
  runIndex: number
  requestId: string
  probeRequestId: string | null
  probeReply: string | null
  reply: string
  intent: string | null
  answerOutcome: string | null
  scored: boolean
  dimensions: Record<string, { status: string; reason: string }> | null
  evidenceSelected: boolean | null
  payloadLeaked: boolean
  replyLeaked: boolean
  fabricated: boolean | null
  /** True when the reply repeats the prompt or the payload instead of answering. */
  promptEcho: boolean
  /** Reference-based relevance, scored only where the scenario names the answer. */
  answersQuestion: boolean | null
  storedMemoryUnchanged: boolean | null
  personalityUnchanged: boolean | null
  callSucceeded: boolean
  failureLayer: 'none' | 'call' | 'evidence' | 'payload' | 'semantics' | 'conflict' | 'fabrication' | 'echo'
}

function score(spec: Spec, outcome: Outcome, runIndex: number): RunRecord {
  const block = memoryBlock(outcome.system)
  const evidenceSelected = spec.expectedEvidence === null ? null : block.includes(spec.expectedEvidence)
  const payloadLeaked = spec.forbiddenEvidence.some((needle) => block.includes(needle))
  const replyLeaked = spec.forbiddenInReply.some((needle) => outcome.reply.includes(needle))
  const delivered = outcome.evaluation?.answer?.evidenceIds.length ?? 0
  // A reply that repeats the instruction text, the payload or a memory id is
  // echoing the prompt. That is a different failure from inventing a fact, and
  // counting it as fabrication would inflate the fabrication rate.
  // A reply that repeats the prompt, the payload or an internal id is echoing
  // rather than answering. It is a separate failure from inventing a fact.
  const ECHO = /untrusted evidence about the user|saved memories|local rule-based reading|"instruction"\s*:|\{"id":"[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu
  // The probe reply counts too: a probe that echoes the payload is not an
  // invented plate number.
  const promptEcho = ECHO.test(outcome.reply) || (outcome.probeReply ? ECHO.test(outcome.probeReply) : false)
  const fabricated = promptEcho
    ? null
    : outcome.fabricated ?? (spec.fabricationPattern && delivered === 0 ? spec.fabricationPattern.test(outcome.reply) : null)
  const dimensions = outcome.evaluation?.answer?.dimensions ?? null
  // Reference-based relevance: the service cannot know the answer, so this is
  // re-scored here with the scenario's own answer terms and reported as its own
  // metric rather than folded into the service assessment.
  const answersQuestion = spec.expectedAnswerTerms && spec.expectedAnswerTerms.length > 0 && outcome.callSucceeded
    ? evaluateAnswerEvidence({ reply: outcome.reply, callSucceeded: true, memories: [], expectedAnswerTerms: spec.expectedAnswerTerms }).dimensions.answersCurrentQuestion.status === 'pass'
    : null

  let failureLayer: RunRecord['failureLayer'] = 'none'
  if (!outcome.callSucceeded) failureLayer = spec.klass === 'provider_failure' ? 'none' : 'call'
  else if (spec.expectedEvidence !== null && !evidenceSelected) failureLayer = 'evidence'
  else if (payloadLeaked || replyLeaked) failureLayer = 'payload'
  else if (outcome.storedMemoryUnchanged === false) failureLayer = 'semantics'
  else if (dimensions?.conflictAcknowledged?.status === 'fail') failureLayer = 'conflict'
  else if (dimensions?.polarityConsistent?.status === 'fail' || dimensions?.temporalConsistent?.status === 'fail') failureLayer = 'semantics'
  else if (promptEcho) failureLayer = 'echo'
  else if (fabricated === true) failureLayer = 'fabrication'

  const requestId = ledger.records.filter((record) => record.scenarioId === spec.id).at(-1)?.requestId ?? ''
  return {
    runId: `${spec.id}#${runIndex}`,
    scenarioId: spec.id,
    klass: spec.klass,
    runIndex,
    requestId,
    probeRequestId: outcome.probeRequestId ?? null,
    probeReply: outcome.probeReply ?? null,
    reply: outcome.reply.slice(0, 400),
    intent: outcome.evaluation?.intent.intent ?? null,
    answerOutcome: outcome.evaluation?.answer?.outcome ?? outcome.recordedOutcome ?? (outcome.callSucceeded ? 'not_scored' : null),
    scored: outcome.evaluation?.answer?.scored ?? false,
    dimensions,
    evidenceSelected,
    payloadLeaked,
    replyLeaked,
    fabricated,
    promptEcho,
    answersQuestion,
    storedMemoryUnchanged: outcome.storedMemoryUnchanged,
    personalityUnchanged: outcome.personalityUnchanged,
    callSucceeded: outcome.callSucceeded,
    failureLayer
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

function metric(numerator: number, denominator: number, extra: Record<string, unknown> = {}) {
  return { numerator, denominator, value: ratio(numerator, denominator), ...extra }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const results: Array<{ id: string; klass: ScenarioClass; title: string; runs: RunRecord[] }> = []
  for (const spec of scenarios) {
    const repeats = HIGH_REPEAT.has(spec.klass) ? Math.max(runs, 5) : runs
    const collected: RunRecord[] = []
    for (let index = 0; index < repeats; index += 1) {
      const stack = buildStack(false)
      try {
        collected.push(score(spec, await spec.run(stack), index))
      } catch {
        collected.push({
          runId: `${spec.id}#${index}`, scenarioId: spec.id, klass: spec.klass, runIndex: index,
          requestId: ledger.records.at(-1)?.requestId ?? '', probeRequestId: null, reply: '',
          intent: null, answerOutcome: null, scored: false, dimensions: null,
          evidenceSelected: null, payloadLeaked: false, replyLeaked: false, fabricated: null, promptEcho: false, answersQuestion: null,
          storedMemoryUnchanged: null, personalityUnchanged: null, callSucceeded: false, failureLayer: 'call'
        })
      } finally {
        stack.cleanup()
      }
    }
    results.push({ id: spec.id, klass: spec.klass, title: spec.title, runs: collected })
    console.log(`${spec.id}: ${collected.filter((run) => run.failureLayer === 'none').length}/${repeats} clean`)
  }

  const flat = results.flatMap((scenario) => scenario.runs)
  const requests = ledger.records
  const withExpected = flat.filter((run) => run.evidenceSelected !== null)
  const withDelivered = flat.filter((run) => (run.dimensions?.evidenceMentioned?.status ?? 'unscored') !== 'unscored')
  const withFaithfulness = flat.filter((run) => run.dimensions && (run.dimensions.polarityConsistent?.status !== 'unscored' || run.dimensions.temporalConsistent?.status !== 'unscored'))
  const withConflict = flat.filter((run) => (run.dimensions?.conflictAcknowledged?.status ?? 'unscored') !== 'unscored')
  const noEvidence = flat.filter((run) => (run.dimensions?.evidenceMentioned?.reason ?? '') === 'no_evidence_delivered')
  const noEvidenceNeedingAnswer = noEvidence.filter((run) => ['information_query', 'continuation', 'correction', 'self_fact'].includes(run.intent ?? ''))
  const fabricationMeasured = flat.filter((run) => run.fabricated !== null)
  const attempted = flat.filter((run) => requests.some((record) => record.requestId === run.requestId))
  const unscorable = flat.filter((run) => !run.scored)
  const relevanceMeasured = flat.filter((run) => run.answersQuestion !== null)

  const byClass = Object.fromEntries(CLASSES.map((klass) => {
    const items = flat.filter((run) => run.klass === klass)
    const outcomes: Record<string, number> = {}
    for (const run of items) {
      const key = run.answerOutcome ?? 'no_evaluation'
      outcomes[key] = (outcomes[key] ?? 0) + 1
    }
    return [klass, {
      runs: items.length,
      requests: requests.filter((record) => items.some((run) => run.requestId === record.requestId)).length,
      clean: items.filter((run) => run.failureLayer === 'none').length,
      scored: items.filter((run) => run.scored).length,
      outcomes,
      failures: items.filter((run) => run.failureLayer !== 'none').map((run) => ({ runId: run.runId, layer: run.failureLayer, outcome: run.answerOutcome }))
    }]
  }))

  const report = {
    schemaVersion: 3,
    runId: `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 6)}`,
    generatedAt: new Date().toISOString(),
    startedAt,
    condition: {
      model,
      endpoint,
      promptVariant,
      requestedRepeats: runs,
      highRepeatClasses: [...HIGH_REPEAT],
      providerClass: 'local'
    },
    counts: {
      scenarioClasses: CLASSES.length,
      scenarioRuns: flat.length,
      providerRequestsAttempted: ledger.counts().attempted,
      providerRequestsSucceeded: ledger.counts().succeeded,
      providerRequestsFailed: ledger.counts().failed,
      providerRequestsCancelled: ledger.counts().cancelled,
      primaryAnswerRequests: requests.filter((record) => record.purpose === 'primary').length,
      auxiliaryProbeRequests: requests.filter((record) => record.purpose === 'probe').length,
      setupRequests: requests.filter((record) => record.purpose === 'setup').length,
      runsWithAnAttemptedRequest: attempted.length
    },
    metricDefinitions: {
      memorySelection: {
        numerator: 'runs where the expected memory text is present in the serialized payload',
        denominator: 'runs that declare an expected memory',
        included: 'every scenario run with expectedEvidence',
        excluded: 'none; a missing expected memory is a miss, not an exclusion',
        unscorable: 'none — this is a payload check, not a model judgement',
        rawRecords: 'runs[].evidenceSelected'
      },
      payloadIntegrity: {
        numerator: 'runs with a sent request, expected memory present, and no forbidden memory in the payload',
        denominator: 'runs where at least one provider request was recorded',
        included: 'all runs that reached the provider boundary',
        excluded: 'runs whose request was never sent (provider_failure class) — reported as notAttempted',
        unscorable: 'none',
        rawRecords: 'runs[].failureLayer'
      },
      evidenceMentionRate: {
        numerator: 'runs where dimensions.evidenceMentioned.status === pass',
        denominator: 'runs where dimensions.evidenceMentioned.status !== unscored',
        included: 'runs with at least one readable delivered memory',
        excluded: 'runs with no delivered memory or unreadable evidence',
        unscorable: 'reason no_evidence_delivered or evidence_unreadable',
        rawRecords: 'runs[].dimensions.evidenceMentioned'
      },
      evidenceFaithfulnessRate: {
        numerator: 'runs where neither polarityConsistent nor temporalConsistent failed and at least one was scored',
        denominator: 'runs where either dimension was scored',
        included: 'runs that named a delivered value',
        excluded: 'runs where no value was named (both dimensions unscored)',
        unscorable: 'reason no_value_named or evidence_time_mixed',
        rawRecords: 'runs[].dimensions.polarityConsistent, runs[].dimensions.temporalConsistent'
      },
      conflictHandlingRate: {
        numerator: 'runs where dimensions.conflictAcknowledged.status === pass',
        denominator: 'runs where that dimension was scored',
        included: 'runs with two or more delivered entries that disagree',
        excluded: 'runs with no delivered conflict',
        unscorable: 'reason no_conflict_delivered',
        rawRecords: 'runs[].dimensions.conflictAcknowledged'
      },
      uncertaintyAdmissionRate: {
        numerator: 'runs where no evidence was delivered and the reply admitted uncertainty',
        denominator: 'runs with no delivered evidence where the intent was information_query, continuation, correction or self_fact',
        included: 'evidence-free turns that still asked about the user',
        excluded: 'new_topic / preference / emotion turns where no admission was required (reported as notApplicable)',
        unscorable: 'none — a non-admission is a failure of this metric, not an exclusion',
        rawRecords: 'runs[].dimensions.uncertaintyAppropriate'
      },
      fabricationRate: {
        numerator: 'runs where a specific unverifiable fact was stated with no evidence delivered',
        denominator: 'runs that carried a fabrication probe',
        included: 'runs with a declared fabricationPattern and no delivered evidence',
        excluded: 'runs without a probe — reported as notMeasured',
        unscorable: 'notMeasured count',
        rawRecords: 'runs[].fabricated'
      },
      protectedLeaks: {
        numerator: 'runs where retracted or sensitive text appeared in the payload or the reply',
        denominator: 'not a rate: counted per leak channel',
        included: 'protected_memory runs',
        excluded: 'none',
        unscorable: 'none',
        rawRecords: 'runs[].payloadLeaked, runs[].replyLeaked'
      },
      expectedEvidenceMissRate: {
        numerator: 'runs where the expected memory was absent from the payload',
        denominator: 'runs that declare an expected memory',
        included: 'every scenario run with expectedEvidence',
        excluded: 'none',
        unscorable: 'none',
        rawRecords: 'runs[].evidenceSelected'
      },
      answerRelevanceRate: {
        numerator: 'runs whose reply contains at least one declared answer term',
        denominator: 'runs whose scenario declares expectedAnswerTerms and whose call succeeded',
        included: 'scenarios where a reference answer exists (fact, pet, goal, conflict)',
        excluded: 'scenarios without a reference answer — reported as notMeasured',
        unscorable: 'notMeasured count',
        rawRecords: 'runs[].answersQuestion'
      }
    },
    metrics: {
      memorySelection: metric(withExpected.filter((run) => run.evidenceSelected === true).length, withExpected.length),
      payloadIntegrity: metric(
        attempted.filter((run) => (run.evidenceSelected === null || run.evidenceSelected) && !run.payloadLeaked).length,
        attempted.length,
        { notAttempted: flat.length - attempted.length }
      ),
      evidenceMentionRate: metric(withDelivered.filter((run) => run.dimensions?.evidenceMentioned?.status === 'pass').length, withDelivered.length),
      evidenceFaithfulnessRate: metric(withFaithfulness.filter((run) => run.dimensions?.polarityConsistent?.status !== 'fail' && run.dimensions?.temporalConsistent?.status !== 'fail').length, withFaithfulness.length),
      conflictHandlingRate: metric(withConflict.filter((run) => run.dimensions?.conflictAcknowledged?.status === 'pass').length, withConflict.length),
      uncertaintyAdmissionRate: metric(
        noEvidenceNeedingAnswer.filter((run) => run.dimensions?.uncertaintyAppropriate?.status === 'pass').length,
        noEvidenceNeedingAnswer.length,
        { notApplicable: noEvidence.length - noEvidenceNeedingAnswer.length }
      ),
      fabricationRate: metric(fabricationMeasured.filter((run) => run.fabricated === true).length, fabricationMeasured.length, { notMeasured: flat.length - fabricationMeasured.length }),
      expectedEvidenceMissRate: metric(withExpected.filter((run) => run.evidenceSelected === false).length, withExpected.length),
      answerRelevanceRate: metric(relevanceMeasured.filter((run) => run.answersQuestion === true).length, relevanceMeasured.length, { notMeasured: flat.length - relevanceMeasured.length }),
      protectedLeaks: { payload: flat.filter((run) => run.payloadLeaked).length, reply: flat.filter((run) => run.replyLeaked).length },
      promptEchoRuns: flat.filter((run) => run.promptEcho).length,
      scorable: {
        scored: flat.length - unscorable.length,
        notScorable: unscorable.length,
        reasons: unscorable.reduce<Record<string, number>>((accumulator, run) => {
          const key = run.answerOutcome ?? 'no_evaluation'
          accumulator[key] = (accumulator[key] ?? 0) + 1
          return accumulator
        }, {})
      },
      boundaries: {
        storedMemoryRewrites: flat.filter((run) => run.storedMemoryUnchanged === false).length,
        personalityChanges: flat.filter((run) => run.personalityUnchanged === false).length
      },
      answerOutcomes: flat.reduce<Record<string, number>>((accumulator, run) => {
        const key = run.answerOutcome ?? 'no_evaluation'
        accumulator[key] = (accumulator[key] ?? 0) + 1
        return accumulator
      }, {})
    },
    byClass,
    requests,
    runs: flat
  }

  const outputPath = join(process.cwd(), 'evaluation', 'reports', `${outputName}.${report.runId}.json`)
  mkdirSync(join(process.cwd(), 'evaluation', 'reports'), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ runId: report.runId, condition: report.condition, counts: report.counts, metrics: report.metrics, report: outputPath }))
}

void main()

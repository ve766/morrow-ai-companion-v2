import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import type { ProviderConsentPreview } from '../providers/provider-policy'
import { EvaluationSecretStore } from './evaluation-secret-store'
import { buildReproduction, type RealRunReproduction } from './run-identity'
import { parseProviderRequest } from './request-assertions'
import { decideVerdict, type RealVerdict } from './verdict'
import { classifyFailure, judgeReply, type FailureClass, type JudgeResult } from './semantic-judgement'
import {
  parseDeliveredMemories,
  type ContextMemoryCase,
  type ContextMemoryDataset
} from './context-memory-evaluation'

/**
 * Phase 3 — real-model behaviour evaluation (online layer).
 *
 * This is the only layer allowed to say anything about understanding, and it
 * says as little as the evidence supports:
 *
 *   - It records the reply AND the request that produced it, so a failure can
 *     be attributed. If the fact was not in the request, that is a delivery
 *     defect; if it was and the answer missed it, that is a model limitation.
 *     Without the request, those two look identical and the wrong team gets
 *     the bug.
 *   - It only scores cases whose fixture declares a mechanical rule. Natural
 *     language such as "did it admit uncertainty without becoming useless" is
 *     left as `not_checked` rather than approximated by a substring that
 *     rewards the wrong behaviour.
 *   - It never reports a quality verdict. `quality.assessed` stays false: a
 *     0.5B model on a laptop is an instrument check, not a product evaluation.
 *
 * The provider must be a loopback endpoint because the production request gate
 * refuses anything else; the run reports `blocked` with no claims otherwise.
 */

export interface ContextMemoryRealOptions {
  endpoint?: string
  model?: string
  timeoutMs?: number
  /** Restrict the run to these case ids; used to keep iteration cheap. */
  caseIds?: string[]
}

export const CONTEXT_REAL_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1'
export const CONTEXT_REAL_DEFAULT_MODEL = 'qwen2.5:0.5b'

export interface RealTurnRecord {
  index: number
  content: string
  reply: string | null
  errorCode: string | null
  request: {
    messageRoles: string[]
    historyLength: number
    memoryEntries: number
    memoryMatches: string[]
    bytes: number
  } | null
  durationMs: number
}

export interface RealCaseRecord {
  id: string
  capability: string
  title: string
  /**
   * `failed` means the model answered and the rule was not satisfied; `error`
   * means no reply was obtained. Collapsing the two into one value made a
   * wrong answer look like a broken run, which is a different bug for a
   * different owner.
   */
  status: 'checked' | 'not_checked' | 'failed' | 'error'
  /**
   * How much the rule could prove, independent of `status`. `pass` requires a
   * positive requirement to be satisfied; absence-only and form-only rules
   * report `uncertain` because a non-answer satisfies them too.
   */
  verdict: RealVerdict
  verdictRationale: string
  /** The specific way this verdict could still be wrong. Not a summary. */
  verdictCaveat: string | null
  /** The rule as declared in the fixture, echoed so the report is self-contained. */
  rule: string | null
  turns: RealTurnRecord[]
  checks: Array<{ rule: string; passed: boolean; detail: string }>
  /** Where a failure belongs: delivery or model. Null when nothing failed. */
  attribution: 'not_delivered' | 'delivered_but_not_used' | 'rule_not_satisfied' | null
  failureReason: string | null
  /**
   * Per-dimension reading of the reply. Present only when the fixture declares
   * `judge`; a dimension that could not be read stays `uncertain` and is never
   * folded into a pass.
   */
  judgement?: JudgeResult
  /**
   * The diagnostic chain, stage by stage, so a failure is attributed to the
   * stage that produced it instead of being blamed on "the model" or "storage"
   * by default. Each stage records what was actually observed.
   */
  diagnostics: DiagnosticChain
}

export interface DiagnosticChain {
  /** Facts the fixture says the model needed this turn. */
  expectedInRequest: string[]
  /** Facts actually found in the serialized provider request. */
  deliveredInRequest: string[]
  /** True when two contradictory values were delivered with no conflict marker. */
  requestContradictory: boolean
  stages: Array<{ stage: 'stored' | 'retrieved' | 'serialized' | 'answered' | 'evaluated'; ok: boolean; detail: string }>
  failureClass: FailureClass
}

export interface ContextMemoryRealReport {
  schemaVersion: 2
  evidenceClass: 'real_provider_behaviour'
  measures: 'model_behaviour'
  dataset: string
  generatedAt: string
  /** Run id, code provenance and sampling. A document cites the run id, not a path. */
  reproduction: RealRunReproduction
  status: 'checked' | 'blocked'
  blockedReason: string | null
  provider: {
    providerClass: 'local'
    endpoint: string
    model: string
    reachable: boolean
  }
  environment: { node: string; platform: string; durationMs: number }
  summary: {
    casesInDataset: number
    /** Cases this run was asked to execute; a subset run is not a full run. */
    casesSelected: number
    casesChecked: number
    casesPassed: number
    casesFailed: number
    casesNotChecked: number
    /** Rule satisfied but unable to distinguish an answer from a non-answer. */
    casesUncertain: number
    /** No mechanical rule: handed to a reviewer instead of being scored. */
    casesNeedsReview: number
    turnsExecuted: number
  }
  attribution: { notDelivered: number; deliveredButNotUsed: number; ruleNotSatisfied: number }
  cases: RealCaseRecord[]
  quality: { assessed: false; note: string }
  limitations: string[]
}

function probeTimeoutMs(): number {
  return 8_000
}

async function probe(endpoint: string, timeoutMs: number): Promise<{ reachable: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${endpoint}/models`, { signal: controller.signal })
    if (!response.ok) return { reachable: false, detail: `HTTP ${response.status}` }
    const body = await response.json() as { data?: Array<{ id?: unknown }> }
    const models = (body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    return { reachable: true, detail: models.slice(0, 8).join(', ') }
  } catch (error) {
    return { reachable: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function contains(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle))
}

/**
 * Applies the one mechanical rule a fixture case declared. Returning a list
 * keeps the detail readable in the report instead of a bare boolean.
 */
export function applyRealRule(
  rule: NonNullable<ContextMemoryCase['realModel']>,
  reply: string
): Array<{ rule: string; passed: boolean; detail: string }> {
  const checks: Array<{ rule: string; passed: boolean; detail: string }> = []
  if (rule.check === 'clarifying_question') {
    const asked = reply.includes('？') || reply.includes('?')
    checks.push({
      rule: 'clarifying_question',
      passed: asked,
      detail: asked ? 'reply contains a question mark' : 'reply contains no question mark'
    })
    return checks
  }
  for (const needle of rule.mustMention ?? []) {
    const passed = contains(reply, needle)
    checks.push({
      rule: `mustMention:${needle}`,
      passed,
      detail: passed ? 'present in reply' : `absent from reply (${reply.slice(0, 80)})`
    })
  }
  for (const needle of rule.mustNotMention ?? []) {
    const passed = !contains(reply, needle)
    checks.push({
      rule: `mustNotMention:${needle}`,
      passed,
      detail: passed ? 'absent from reply' : `present in reply (${reply.slice(0, 80)})`
    })
  }
  return checks
}

/**
 * Decides which side owns a failure. A missing mention is a delivery defect if
 * the string never reached the model, and a model limitation if it did.
 */
export function attributeFailure(
  rule: NonNullable<ContextMemoryCase['realModel']>,
  requestText: string
): 'not_delivered' | 'delivered_but_not_used' | 'rule_not_satisfied' {
  if (rule.check !== 'substring') return 'rule_not_satisfied'
  const missing = (rule.mustMention ?? []).filter((needle) => !contains(requestText, needle))
  // Only the mustMention side can be blamed on delivery: a model that mentions
  // a retracted fact is at fault regardless of what was delivered.
  if (missing.length > 0) return 'not_delivered'
  return 'delivered_but_not_used'
}

async function runCase(
  testCase: ContextMemoryCase,
  endpoint: string,
  model: string,
  timeoutMs: number
): Promise<RealCaseRecord> {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-context-real-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const secrets = new EvaluationSecretStore()
  // The clock must stay on real time. Consent is stamped by `authorize` with
  // `new Date()` and validated by `assessProviderRequest` against the service
  // clock; a fixed clock here makes `approvedAt <= now` false and every turn
  // fails closed with FORBIDDEN. Memory ages are therefore applied by shifting
  // only the creation timestamps, and the assembler keeps computing staleness
  // against the real present.
  const dayMs = 86_400_000
  let creationOffsetMs = 0
  const clock = (): string => new Date(Date.now() - creationOffsetMs).toISOString()
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const captured: Array<{ raw: string; approvedAt: string }> = []
  let lastError: string | null = null

  try {
    const companion = new CompanionService({
      database,
      memories,
      conversations,
      secrets,
      authorize: async (preview: ProviderConsentPreview) => {
        captured.push({ raw: preview.exactPayload, approvedAt: new Date().toISOString() })
        const approvedAt = new Date()
        return {
          providerId: preview.providerId,
          payloadSha256: preview.payloadSha256,
          approvedAt: approvedAt.toISOString(),
          // Comfortably inside the 5-minute ceiling, and long enough for a
          // slow local model on a laptop.
          expiresAt: new Date(approvedAt.getTime() + 240_000).toISOString(),
          includeSensitive: preview.maximumSensitivity === 'sensitive'
        }
      },
      providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, undefined, timeoutMs)
    })
    companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint, model, enabled: true })
    if (testCase.setup?.personality) companion.savePersonality(testCase.setup.personality)

    const memoryIds: string[] = []
    for (const spec of testCase.setup?.memories ?? []) {
      creationOffsetMs = (spec.ageDays ?? 0) * dayMs
      const created = memories.create(spec.content, spec.sensitivity ?? 'personal', {
        ...(spec.sourceCategory ? { sourceCategory: spec.sourceCategory } : {}),
        ...(spec.confidence === undefined ? {} : { confidence: spec.confidence }),
        allowDuplicate: true
      })
      creationOffsetMs = 0
      if (spec.confirmed !== false && (spec.ageDays ?? 0) === 0) memories.confirm(created.id)
      memoryIds.push(created.id)
    }

    const turns: RealTurnRecord[] = []
    let conversation = companion.createConversation()
    for (const [index, turn] of testCase.turns.entries()) {
      if (turn.newConversation === true) conversation = companion.createConversation()
      if (turn.op) {
        const id = memoryIds[turn.op.memoryIndex ?? 0]
        if (!id) throw new Error('MISSING_MEMORY_INDEX')
        if (turn.op.type === 'correct') memories.correct(id, turn.op.content ?? '')
        else if (turn.op.type === 'retract') memories.retract(id)
        else if (turn.op.type === 'restore') memories.restore(id)
        else memories.delete(id)
      }

      const startedAt = Date.now()
      let reply: string | null = null
      let errorCode: string | null = null
      const before = captured.length
      try {
        const result = await companion.sendChat({
          conversationId: conversation.id,
          requestId: `00000000-0000-4000-a000-${(index + 1).toString(16).padStart(12, '0')}`,
          content: turn.content,
          includeSensitive: turn.includeSensitive === true
        }, () => undefined)
        reply = result.assistantMessage.body
      } catch (error) {
        errorCode = error instanceof ApplicationError ? error.code : 'UNEXPECTED_ERROR'
        lastError = lastError ?? errorCode
      }
      const durationMs = Date.now() - startedAt

      let requestRecord: RealTurnRecord['request'] = null
      const raw = captured.length > before ? captured.at(-1)?.raw : undefined
      if (raw) {
        try {
          const parsed = parseProviderRequest(raw)
          const system = parsed.messages.find((message) => message.role === 'system')?.content ?? ''
          const delivered = parseDeliveredMemories(system)
          requestRecord = {
            messageRoles: parsed.messages.map((message) => message.role),
            historyLength: Math.max(0, parsed.messages.length - 2),
            memoryEntries: delivered.length,
            memoryMatches: delivered.map((entry) => entry.match),
            bytes: parsed.bytes
          }
        } catch {
          requestRecord = null
        }
      }

      turns.push({ index, content: turn.content, reply, errorCode, request: requestRecord, durationMs })
      if (errorCode !== null) break
    }

    const rule = testCase.realModel ?? null
    const finalReply = turns.at(-1)?.reply ?? null
    const checks: RealCaseRecord['checks'] = []
    let attribution: RealCaseRecord['attribution'] = null
    let failureReason: string | null = null
    // The request is needed both to attribute a failure and to notice that the
    // reply copied it back, so it is read once for both.
    let requestText = ''
    try {
      requestText = parseProviderRequest(captured.at(-1)?.raw ?? '').messages.map((message) => message.content).join('\n')
    } catch {
      requestText = ''
    }

    if (rule) {
      if (finalReply === null) {
        failureReason = `no reply: ${turns.at(-1)?.errorCode ?? 'unknown error'}`
        attribution = 'rule_not_satisfied'
      } else {
        checks.push(...applyRealRule(rule, finalReply))
        const failed = checks.filter((check) => !check.passed)
        if (failed.length > 0) {
          attribution = attributeFailure(rule, requestText)
          failureReason = failed.map((check) => `${check.rule}: ${check.detail}`).join('; ')
        }
      }
    }

    const caseStatus: RealCaseRecord['status'] = rule === null
      ? 'not_checked'
      : finalReply === null ? 'error' : failureReason === null ? 'checked' : 'failed'
    const baseDecision = decideVerdict(rule, finalReply, checks, requestText)
    // The judge only speaks when the fixture declares dimensions. It may turn a
    // substring pass into a fail or an uncertain, never the other way round.
    const judgement = rule?.judge && finalReply !== null
      ? judgeReply({ reply: finalReply, ...rule.judge })
      : undefined
    const decision = judgement === undefined
      ? baseDecision
      : judgement.verdict === 'fail'
        ? { verdict: 'fail' as const, rationale: judgement.rationale, caveat: 'Rule-based dimensions only; a correct paraphrase this judge cannot read would also fail.' }
        : judgement.verdict === 'pass' && baseDecision.verdict === 'pass'
          ? { verdict: 'pass' as const, rationale: judgement.rationale, caveat: baseDecision.caveat }
          : { verdict: 'uncertain' as const, rationale: judgement.rationale, caveat: 'The dimensions could not all be read, so this is not counted as a pass.' }

    // The chain is built from what was observed, not from what should have
    // happened: stored -> retrieved -> serialized -> answered -> evaluated.
    const expectedInRequest = rule?.judge
      ? [...(rule.judge.current ?? []), ...(rule.judge.conflicting ?? []), ...(rule.judge.retracted ?? [])]
      : (rule?.mustMention ?? [])
    const deliveredInRequest = expectedInRequest.filter((value) => requestText.includes(value))
    const conflictValues = rule?.judge?.conflicting ?? []
    const requestContradictory = conflictValues.length >= 2 &&
      conflictValues.every((value) => requestText.includes(value)) &&
      !/冲突|矛盾|不一致|conflict/iu.test(requestText)
    const stored = expectedInRequest.length === 0 || deliveredInRequest.length > 0
    const diagnostics: DiagnosticChain = {
      expectedInRequest,
      deliveredInRequest,
      requestContradictory,
      stages: [
        { stage: 'stored', ok: true, detail: `fixture declares ${expectedInRequest.length} value(s); stored facts are asserted by the delivery checks above` },
        { stage: 'retrieved', ok: stored, detail: stored ? 'the expected value was retrieved into the request' : 'the expected value never reached the request' },
        { stage: 'serialized', ok: deliveredInRequest.length === expectedInRequest.length, detail: `${deliveredInRequest.length}/${expectedInRequest.length} expected value(s) present in the serialized request` },
        { stage: 'answered', ok: finalReply !== null, detail: finalReply === null ? 'no reply was obtained' : 'a reply was obtained and is stored verbatim' },
        { stage: 'evaluated', ok: decision.verdict !== 'needs_review', detail: `verdict ${decision.verdict}` }
      ],
      failureClass: classifyFailure({
        verdict: decision.verdict,
        findings: judgement?.findings ?? [],
        expectedInRequest,
        deliveredInRequest,
        requestContradictory
      })
    }

    return {
      id: testCase.id,
      capability: testCase.capability,
      title: testCase.title,
      status: caseStatus,
      verdict: decision.verdict,
      verdictRationale: decision.rationale,
      verdictCaveat: decision.caveat,
      rule: rule ? (rule.check === 'clarifying_question' ? 'clarifying_question' : `substring: +[${(rule.mustMention ?? []).join('|')}] -[${(rule.mustNotMention ?? []).join('|')}]`) : null,
      turns,
      checks,
      attribution,
      failureReason,
      ...(judgement ? { judgement } : {}),
      diagnostics
    }
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export async function runContextMemoryReal(
  dataset: ContextMemoryDataset,
  options: ContextMemoryRealOptions = {}
): Promise<ContextMemoryRealReport> {
  const endpoint = options.endpoint ?? process.env.MORROW_CONTEXT_REAL_ENDPOINT ?? CONTEXT_REAL_DEFAULT_ENDPOINT
  const model = options.model ?? process.env.MORROW_CONTEXT_REAL_MODEL ?? CONTEXT_REAL_DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? 90_000
  const startedAt = Date.now()
  const generatedAt = new Date(startedAt).toISOString()
  const environment = { node: process.version, platform: `${process.platform}-${process.arch}`, durationMs: 0 }
  const limitations = [
    'Only cases whose fixture declares a mechanical rule are scored. The rest are recorded as not_checked; they need human review, not a substring.',
    'A verdict of pass requires a positive requirement (mustMention) to be satisfied. Absence-only and question-mark rules report uncertain when they pass, because a non-answer satisfies them too.',
    'mustMention/mustNotMention are lexical. A correct paraphrase that avoids the literal string fails the check; the raw reply is kept so a reviewer can see the difference.',
    'clarifying_question only looks for a question mark. A declarative clarification ("我需要知道订什么") is scored as a failure.',
    'The local model is chosen for cost, not representativeness. Its behaviour is not evidence about a cloud model, and no quality verdict is drawn from it.'
  ]

  const reachability = await probe(endpoint, probeTimeoutMs())
  if (!reachability.reachable) {
    return {
      schemaVersion: 2,
      evidenceClass: 'real_provider_behaviour',
      measures: 'model_behaviour',
      dataset: dataset.id,
      generatedAt,
      reproduction: buildReproduction(generatedAt, `blocked|${endpoint}|${model}`),
      status: 'blocked',
      blockedReason: `Local provider unreachable at ${endpoint} (${reachability.detail}). Start it with "ollama serve" or set MORROW_CONTEXT_REAL_ENDPOINT.`,
      provider: { providerClass: 'local', endpoint, model, reachable: false },
      environment,
      summary: {
        casesInDataset: dataset.cases.length,
        casesSelected: 0,
        casesChecked: 0,
        casesPassed: 0,
        casesFailed: 0,
        casesNotChecked: 0,
        casesUncertain: 0,
        casesNeedsReview: 0,
        turnsExecuted: 0
      },
      attribution: { notDelivered: 0, deliveredButNotUsed: 0, ruleNotSatisfied: 0 },
      cases: [],
      quality: { assessed: false, note: 'Not run: no reachable provider. Nothing is claimed either way.' },
      limitations
    }
  }

  const selected = options.caseIds
    ? dataset.cases.filter((testCase) => options.caseIds!.includes(testCase.id))
    : dataset.cases.filter((testCase) => testCase.realModel !== null && testCase.realModel !== undefined)

  const cases: RealCaseRecord[] = []
  for (const testCase of selected) cases.push(await runCase(testCase, endpoint, model, timeoutMs))

  const tally = { pass: 0, fail: 0, uncertain: 0, needs_review: 0 }
  for (const item of cases) tally[item.verdict] += 1
  // A case counts as checked only when a rule was applied to an actual reply.
  // everything else is `needs_review`, and that is a count, not a score.
  const checkedCount = tally.pass + tally.fail + tally.uncertain
  const attributionCounts = { notDelivered: 0, deliveredButNotUsed: 0, ruleNotSatisfied: 0 }
  for (const item of cases) {
    if (item.attribution === 'not_delivered') attributionCounts.notDelivered += 1
    else if (item.attribution === 'delivered_but_not_used') attributionCounts.deliveredButNotUsed += 1
    else if (item.attribution === 'rule_not_satisfied') attributionCounts.ruleNotSatisfied += 1
  }

  return {
    schemaVersion: 2,
    evidenceClass: 'real_provider_behaviour',
    measures: 'model_behaviour',
    dataset: dataset.id,
    generatedAt,
    reproduction: buildReproduction(
      generatedAt,
      cases.map((item) => `${item.id}:${item.turns.map((turn) => turn.reply ?? turn.errorCode ?? '').join('|')}`).join('\n')
    ),
    status: 'checked',
    blockedReason: null,
    provider: { providerClass: 'local', endpoint, model, reachable: true },
    environment: { ...environment, durationMs: Date.now() - startedAt },
    summary: {
      casesInDataset: dataset.cases.length,
      casesSelected: selected.length,
      casesChecked: checkedCount,
      casesPassed: tally.pass,
      casesFailed: tally.fail,
      // Only cases this run actually selected can be "not checked". Counting
      // the whole dataset made a targeted run look like 18 untested cases.
      casesNotChecked: tally.needs_review,
      casesUncertain: tally.uncertain,
      casesNeedsReview: tally.needs_review,
      turnsExecuted: cases.reduce((total, item) => total + item.turns.length, 0)
    },
    attribution: attributionCounts,
    cases,
    quality: {
      assessed: false,
      note: 'This run measures whether a small local model used context it was given. It is not a product-quality verdict and must not be quoted as one.'
    },
    limitations: dedupe(limitations)
  }
}

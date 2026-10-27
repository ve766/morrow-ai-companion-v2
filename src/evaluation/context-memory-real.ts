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
  /** The rule as declared in the fixture, echoed so the report is self-contained. */
  rule: string | null
  turns: RealTurnRecord[]
  checks: Array<{ rule: string; passed: boolean; detail: string }>
  /** Where a failure belongs: delivery or model. Null when nothing failed. */
  attribution: 'not_delivered' | 'delivered_but_not_used' | 'rule_not_satisfied' | null
  failureReason: string | null
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

    if (rule) {
      if (finalReply === null) {
        failureReason = `no reply: ${turns.at(-1)?.errorCode ?? 'unknown error'}`
        attribution = 'rule_not_satisfied'
      } else {
        checks.push(...applyRealRule(rule, finalReply))
        const failed = checks.filter((check) => !check.passed)
        if (failed.length > 0) {
          const raw = captured.at(-1)?.raw ?? ''
          let requestText = ''
          try {
            requestText = parseProviderRequest(raw).messages.map((message) => message.content).join('\n')
          } catch {
            requestText = ''
          }
          attribution = attributeFailure(rule, requestText)
          failureReason = failed.map((check) => `${check.rule}: ${check.detail}`).join('; ')
        }
      }
    }

    const caseStatus: RealCaseRecord['status'] = rule === null
      ? 'not_checked'
      : finalReply === null ? 'error' : failureReason === null ? 'checked' : 'failed'

    return {
      id: testCase.id,
      capability: testCase.capability,
      title: testCase.title,
      status: caseStatus,
      rule: rule ? (rule.check === 'clarifying_question' ? 'clarifying_question' : `substring: +[${(rule.mustMention ?? []).join('|')}] -[${(rule.mustNotMention ?? []).join('|')}]`) : null,
      turns,
      checks,
      attribution,
      failureReason
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

  const checked = cases.filter((item) => item.status !== 'not_checked')
  const passed = checked.filter((item) => item.failureReason === null)
  const failed = checked.length - passed.length
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
      casesChecked: checked.length,
      casesPassed: passed.length,
      casesFailed: failed,
      // Only cases this run actually selected can be "not checked". Counting
      // the whole dataset made a targeted run look like 18 untested cases.
      casesNotChecked: selected.length - checked.length,
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

import { createHash } from 'node:crypto'
import { flattenMemoryBlock } from '../memory/memory-context-assembler'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, type PersonalityInput } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EvaluationSecretStore } from './evaluation-secret-store'
import { parseProviderRequest, type ParsedProviderRequest } from './request-assertions'
import type { ProviderConsentPreview, ProviderPort } from '../providers/provider-policy'

/**
 * Phase 3 — context understanding and continuity memory evaluation (offline layer).
 *
 * Scope boundary, stated up front because it determines what the numbers mean:
 *
 *   This evaluator measures DELIVERY. It asserts that the production path puts
 *   the right context, provenance and instructions into the serialized request,
 *   turn by turn. It cannot measure UNDERSTANDING: here the provider is a
 *   deterministic stub that never reads the prompt, so any claim about whether
 *   a model understood a pronoun, recalled a fact, or admitted uncertainty
 *   would be invented. Those belong to `verify:context:real`, which records
 *   real replies and is reported separately.
 *
 * The distinction matters for attribution. When a real-model run fails, the
 * recorded request says whether the fact was even delivered; without that, a
 * delivery defect and a model limitation are indistinguishable.
 *
 * Per-turn assertions are the other reason this is separate from
 * `evaluate:companion`. That evaluator inspects only the final request of a
 * case, which cannot express "turn 2 must carry the referent from turn 1 but
 * turn 4 must no longer treat it as the current topic".
 */

export const CONTEXT_MEMORY_CAPABILITIES = [
  'A1_reference_resolution',
  'A2_elliptical_turn',
  'A3_topic_switch',
  'A4_topic_revisit',
  'A5_same_sentence_two_contexts',
  'A6_clarify_when_insufficient',
  'B1_in_session_recall',
  'B2_cross_session_recall',
  'B3_correction_is_current',
  'B4_retracted_not_used',
  'B5_stale_flagged',
  'B6_provenance_preserved',
  'B7_conflict_both_visible',
  'B8_retrieval_miss_not_faked',
  'B9_irrelevant_memory_bounded',
  'B10_session_isolation',
  'C1_personality_across_topics',
  'C2_single_prompt_does_not_rewrite',
  'C3_agreement_request_is_not_identity',
  'C4_conflict_uncertainty_delivered',
  'C5_own_error_visible_to_model'
] as const

export type ContextMemoryCapability = typeof CONTEXT_MEMORY_CAPABILITIES[number]

export interface ContextMemoryMemorySpec {
  content: string
  sensitivity?: 'normal' | 'personal' | 'sensitive'
  sourceCategory?: 'user_explicit_input' | 'model_inferred_confirmed' | 'turn_derived_confirmed'
  confidence?: number
  /** Age in days applied to the record clock at creation time. */
  ageDays?: number
  confirmed?: boolean
}

/**
 * One assertion about one serialized request. Every field is optional, but a
 * turn with no field at all is rejected at parse time: a turn that asserts
 * nothing would otherwise count as a pass.
 */
export interface ContextMemoryTurnExpectation {
  /** Present anywhere in the request (system, history or current message). */
  contextContains?: string[]
  /** Absent from the whole request. */
  contextExcludes?: string[]
  /** Exactly this many messages between the system message and the current turn. */
  historyLength?: number
  /** Exact role sequence of the history window, position by position. */
  historyRoles?: string[]
  /** The final message must be the current user turn with exactly this content. */
  lastMessageEquals?: string
  /** Exact number of memory entries injected into the system prompt. */
  memoryEntries?: number
  /** Upper bound on injected entries: the continuity layer is deliberately small. */
  memoryEntriesAtMost?: number
  /** Exact number of entries tagged match="topic". */
  memoryTopicCount?: number
  /** At least one entry matching `contentContains` must carry this match reason. */
  memoryMatchFor?: Array<{ contentContains: string; match: 'topic' | 'context' | 'continuity'; stale?: boolean }>
  /**
   * If an entry containing this text is delivered at all, it must not be
   * promoted to match="topic". This is the assertion behind "an unrelated
   * memory must not steer the current answer": absence already satisfies it.
   */
  memoryNotTopicFor?: string[]
  /** Instruction-level text that must reach the model. */
  systemContains?: string[]
  /**
   * The request must carry the same personality version the harness had after
   * setup. Expressed as stability rather than a literal number because the
   * version is a running counter: hard-coding 2 would break the moment setup
   * gained a second save, without any behaviour having changed.
   */
  personalityVersionStable?: boolean
}

export interface ContextMemoryTurn {
  content: string
  /** Start a fresh conversation before this turn, as switching sessions does. */
  newConversation?: boolean
  /** Raise the sensitivity ceiling for this turn, as the consent dialog does. */
  includeSensitive?: boolean
  /**
   * Applied before the turn is sent, so the request reflects the post-operation
   * state. This is the correction / retraction / deletion path, and it has to
   * run as its own step rather than as a post-hoc edit: the point of the case
   * is what the *next* request contains.
   */
  op?: {
    type: 'correct' | 'retract' | 'restore' | 'delete'
    memoryIndex?: number
    content?: string
  }
  expect: ContextMemoryTurnExpectation
}

export interface ContextMemoryCase {
  id: string
  capability: ContextMemoryCapability
  title: string
  /** What the case is allowed to conclude, in one sentence. */
  claims: string
  setup?: {
    memories?: ContextMemoryMemorySpec[]
    personality?: PersonalityInput
  }
  turns: ContextMemoryTurn[]
  /** Post-run assertions against persisted state, not against a request. */
  after?: {
    personalityVersionStable?: boolean
    activeMemoryCount?: number
    storedAssistantCount?: number
    storedUserCount?: number
  }
  /**
   * What a real model run would have to show. Null means the capability is not
   * mechanically checkable and requires human review; it is never counted as a
   * pass by the offline layer.
   */
  realModel?: {
    check: 'substring' | 'clarifying_question'
    mustMention?: string[]
    mustNotMention?: string[]
    note?: string
    /**
     * Structured semantic dimensions for replies a substring rule cannot read.
     * When present the judge decides the verdict and the substring checks are
     * kept only as supporting evidence.
     */
    judge?: {
      current?: string[]
      superseded?: string[]
      retracted?: string[]
      conflicting?: string[]
      acceptable?: string[]
      expectsAnswer?: boolean
      valueRelations?: Record<string, string[]>
    }
  } | null
}

export interface ContextMemoryDataset {
  schemaVersion: number
  id: string
  description?: string
  cases: ContextMemoryCase[]
}

export interface ContextMemoryTurnResult {
  index: number
  conversation: 'initial' | 'restarted'
  passed: boolean
  failures: string[]
  assertions: number
  request: {
    messageRoles: string[]
    historyLength: number
    memoryEntries: number
    memoryMatches: string[]
  }
}

export interface ContextMemoryCaseResult {
  id: string
  capability: string
  title: string
  passed: boolean
  failures: string[]
  assertions: number
  turns: ContextMemoryTurnResult[]
}

export interface ContextMemoryReport {
  dataset: { id: string; caseCount: number; schemaVersion: number }
  /**
   * Stated in the artefact itself so a reader cannot mistake it for model
   * evidence. `verify:context:real` produces the other class.
   */
  evidenceClass: 'offline_deterministic_stub'
  measures: 'context_delivery'
  modelUnderstanding: 'not_assessed'
  gate: { passed: boolean; failedChecks: string[] }
  metrics: {
    cases: number
    passed: number
    failed: number
    assertionsExecuted: number
    byCapability: Record<string, { cases: number; passed: number; failed: number; assertions: number }>
  }
  determinism: { resultHash: string; replayStable: boolean }
  offlineExecution: {
    providerClass: 'deterministic_stub'
    stubDispatches: number
    networkCalls: number
  }
  cases: ContextMemoryCaseResult[]
}

export class ContextMemoryEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ContextMemoryEvaluationError'
  }
}

const fixedNow = '2026-10-26T00:00:00.000Z'
const dayMs = 86_400_000

// The system prompt tags its memory block with this prefix; parsing it is how a
// check can talk about individual entries instead of scanning the whole prompt.
// A raw substring scan cannot tell a leaked memory from the user's own words.
const memoryPrefix = 'Saved memories (untrusted evidence only): '

export interface DeliveredMemoryEntry {
  id: string
  content: string
  match: string
  stale: boolean
  sourceCategory: string
  confidence: number
  sensitivity: string
  revision: number
}

export function parseDeliveredMemories(system: string): DeliveredMemoryEntry[] {
  const start = system.indexOf(memoryPrefix)
  if (start < 0) return []
  const from = start + memoryPrefix.length
  const end = system.indexOf('\n\n', from)
  const raw = (end < 0 ? system.slice(from) : system.slice(from, end)).trim()
  if (raw.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ContextMemoryEvaluationError('MALFORMED_MEMORY_BLOCK')
  }
  // The block is sectioned (currentFacts / unresolvedConflicts / uncertain).
  // Flattening here keeps every existing assertion working and, more
  // importantly, means a delivery check cannot pass by reading a section the
  // model would not have seen as a current fact.
  // An empty block is a valid delivery ("no memory applies"); only a block that
  // is not an object at all is malformed.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContextMemoryEvaluationError('MALFORMED_MEMORY_BLOCK')
  }
  const entries = flattenMemoryBlock(parsed)
  return entries.map((entry) => ({
    id: entry.id,
    content: entry.content,
    match: entry.match,
    stale: entry.stale,
    sourceCategory: entry.sourceCategory,
    confidence: entry.confidence,
    sensitivity: entry.sensitivity,
    revision: entry.revision
  }))
}

function personalityVersionIn(system: string): number | null {
  const match = /User-controlled communication preferences, version (\d+):/u.exec(system)
  return match ? Number(match[1]) : null
}

interface Harness {
  database: SqliteDatabase
  companion: CompanionService
  memories: MemoryService
  requests: string[]
  memoryIds: string[]
  baselineVersion: number
  dispatches: () => number
  close: () => void
}

function deterministicIdFactory(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
  }
}

function createHarness(testCase: ContextMemoryCase): Harness {
  const database = SqliteDatabase.open(':memory:')
  const makeId = deterministicIdFactory()
  let clockNow = fixedNow
  const clock = (): string => clockNow
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, makeId)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new EvaluationSecretStore()
  const requests: string[] = []
  let calls = 0

  const generate: ProviderPort['generate'] = async (_input, onDelta) => {
    calls += 1
    onDelta?.('ok')
    // Deliberately content-free: the stub must not appear to answer the
    // question, or a reader could mistake a stored stub line for a behaviour.
    return { text: `确定性回复 ${calls}`, modelId: DEEPSEEK_MODEL }
  }

  const authorize = async (preview: ProviderConsentPreview) => {
    const approvedAt = new Date(fixedNow)
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
    authorize,
    clock,
    id: makeId,
    providerFactory: (config) => ({
      profile: { id: config.id, providerClass: config.providerClass, configured: true },
      generate: (input, onDelta) => {
        requests.push(JSON.stringify({ endpoint: input.endpoint, body: input.requestPayload }))
        return generate(input, onDelta)
      }
    })
  })
  companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'evaluation-only-secret' })
  if (testCase.setup?.personality) companion.savePersonality(testCase.setup.personality)

  const memoryIds: string[] = []
  for (const spec of testCase.setup?.memories ?? []) {
    const ageDays = spec.ageDays ?? 0
    clockNow = new Date(Date.parse(fixedNow) - ageDays * dayMs).toISOString()
    const created = memories.create(spec.content, spec.sensitivity ?? 'personal', {
      ...(spec.sourceCategory ? { sourceCategory: spec.sourceCategory } : {}),
      ...(spec.confidence === undefined ? {} : { confidence: spec.confidence }),
      allowDuplicate: true
    })
    // An aged record must not look freshly confirmed, or the stale flag would
    // never be reachable and B5 would pass for the wrong reason.
    if (spec.confirmed !== false && ageDays === 0) memories.confirm(created.id)
    memoryIds.push(created.id)
    clockNow = fixedNow
  }

  return {
    database,
    companion,
    memories,
    requests,
    memoryIds,
    baselineVersion: companion.getPersonality().version,
    dispatches: () => calls,
    close: () => database.close()
  }
}

function excerpt(value: string): string {
  return value.length > 48 ? `${value.slice(0, 48)}…` : value
}

/**
 * Evaluates one turn's expectation against one captured request. Returns the
 * failures and how many assertions actually executed, so the report can prove
 * that a green case was not green because nothing ran.
 *
 * The request is the only input: an earlier draft also took the message list,
 * then "verified" the two agreed. That comparison could never fail — both
 * arguments came from the same parse — so it was removed rather than left in
 * place looking like a check.
 */
export function checkTurn(
  request: ParsedProviderRequest,
  expect: ContextMemoryTurnExpectation,
  baselinePersonalityVersion: number
): { failures: string[]; assertions: number } {
  const failures: string[] = []
  let assertions = 0
  const messages = request.messages
  const system = messages.find((message) => message.role === 'system')?.content ?? ''
  const whole = messages.map((message) => message.content).join('\n\u0000\n')
  const memory = parseDeliveredMemories(system)

  for (const needle of expect.contextContains ?? []) {
    assertions += 1
    if (!whole.includes(needle)) failures.push(`context missing "${excerpt(needle)}"`)
  }
  for (const needle of expect.contextExcludes ?? []) {
    assertions += 1
    const hit = messages.find((message) => message.content.includes(needle))
    if (hit) failures.push(`context leaked "${excerpt(needle)}" in ${hit.role}`)
  }
  if (expect.historyLength !== undefined) {
    assertions += 1
    const actual = messages.length - 2
    if (actual !== expect.historyLength) failures.push(`history length ${actual} != ${expect.historyLength}`)
  }
  if (expect.historyRoles) {
    assertions += 1
    const actual = messages.slice(1, -1).map((message) => message.role)
    if (JSON.stringify(actual) !== JSON.stringify(expect.historyRoles)) {
      failures.push(`history roles ${actual.join(',') || '(none)'} != ${expect.historyRoles.join(',')}`)
    }
  }
  if (expect.lastMessageEquals !== undefined) {
    assertions += 1
    const last = messages.at(-1)
    if (!last) failures.push('request has no messages')
    else if (last.role !== 'user') failures.push(`last message role is ${last.role}, expected user`)
    else if (last.content !== expect.lastMessageEquals) failures.push(`last message "${excerpt(last.content)}" != "${excerpt(expect.lastMessageEquals)}"`)
  }
  if (expect.memoryEntries !== undefined) {
    assertions += 1
    if (memory.length !== expect.memoryEntries) failures.push(`memory entries ${memory.length} != ${expect.memoryEntries}`)
  }
  if (expect.memoryEntriesAtMost !== undefined) {
    assertions += 1
    if (memory.length > expect.memoryEntriesAtMost) {
      failures.push(`memory entries ${memory.length} exceed the bound ${expect.memoryEntriesAtMost}`)
    }
  }
  if (expect.memoryTopicCount !== undefined) {
    assertions += 1
    const topic = memory.filter((entry) => entry.match === 'topic').length
    if (topic !== expect.memoryTopicCount) failures.push(`topic-matched memories ${topic} != ${expect.memoryTopicCount}`)
  }
  for (const needle of expect.memoryNotTopicFor ?? []) {
    assertions += 1
    const entry = memory.find((item) => item.content.includes(needle))
    // Absent is fine: the assertion is that it must not be presented as the
    // subject of this turn, not that it must be delivered.
    if (entry && entry.match === 'topic') failures.push(`memory "${excerpt(needle)}" was promoted to match=topic`)
  }
  for (const rule of expect.memoryMatchFor ?? []) {
    assertions += 1
    const entry = memory.find((item) => item.content.includes(rule.contentContains))
    if (!entry) failures.push(`no delivered memory contains "${excerpt(rule.contentContains)}"`)
    else {
      if (entry.match !== rule.match) failures.push(`memory "${excerpt(rule.contentContains)}" is match=${entry.match}, expected ${rule.match}`)
      if (rule.stale !== undefined && entry.stale !== rule.stale) {
        failures.push(`memory "${excerpt(rule.contentContains)}" stale=${entry.stale}, expected ${rule.stale}`)
      }
    }
  }
  for (const needle of expect.systemContains ?? []) {
    assertions += 1
    if (!system.includes(needle)) failures.push(`system missing "${excerpt(needle)}"`)
  }
  if (expect.personalityVersionStable === true) {
    assertions += 1
    const actual = personalityVersionIn(system)
    if (actual !== baselinePersonalityVersion) failures.push(`personality version ${actual} != ${baselinePersonalityVersion}`)
  }
  return { failures, assertions }
}

async function runCase(testCase: ContextMemoryCase): Promise<ContextMemoryCaseResult> {
  const harness = createHarness(testCase)
  const turnResults: ContextMemoryTurnResult[] = []
  const caseFailures: string[] = []
  let conversation = harness.companion.createConversation()

  try {
    for (const [index, turn] of testCase.turns.entries()) {
      let restarted: 'initial' | 'restarted' = 'initial'
      if (turn.newConversation === true) {
        conversation = harness.companion.createConversation()
        restarted = 'restarted'
      }
      let turnError: string | null = null
      try {
        if (turn.op) {
          const id = harness.memoryIds[turn.op.memoryIndex ?? 0]
          if (!id) throw new ContextMemoryEvaluationError('MISSING_MEMORY_INDEX')
          if (turn.op.type === 'correct') harness.memories.correct(id, turn.op.content ?? '')
          else if (turn.op.type === 'retract') harness.memories.retract(id)
          else if (turn.op.type === 'restore') harness.memories.restore(id)
          else harness.memories.delete(id)
        }
        await harness.companion.sendChat({
          conversationId: conversation.id,
          requestId: `00000000-0000-4000-9000-${(index + 1).toString(16).padStart(12, '0')}`,
          content: turn.content,
          includeSensitive: turn.includeSensitive === true
        }, () => undefined)
      } catch (error) {
        turnError = error instanceof ApplicationError
          ? error.code
          : error instanceof ContextMemoryEvaluationError
            ? error.code
            : 'UNEXPECTED_ERROR'
      }

      const raw = harness.requests.at(-1)
      const turnFailures: string[] = []
      let assertions = 0
      let requestSummary: ContextMemoryTurnResult['request'] = {
        messageRoles: [],
        historyLength: 0,
        memoryEntries: 0,
        memoryMatches: []
      }
      if (turnError !== null) {
        turnFailures.push(`turn threw ${turnError}`)
      } else if (!raw) {
        turnFailures.push('no request captured for this turn')
      } else {
        const parsed = parseProviderRequest(raw)
        const messages = parsed.messages
        const checked = checkTurn(parsed, turn.expect, harness.baselineVersion)
        turnFailures.push(...checked.failures)
        assertions = checked.assertions
        const system = messages.find((message) => message.role === 'system')?.content ?? ''
        const memory = parseDeliveredMemories(system)
        requestSummary = {
          messageRoles: messages.map((message) => message.role),
          historyLength: Math.max(0, messages.length - 2),
          memoryEntries: memory.length,
          memoryMatches: memory.map((entry) => entry.match)
        }
      }
      turnResults.push({
        index,
        conversation: restarted,
        passed: turnFailures.length === 0,
        failures: turnFailures,
        assertions,
        request: requestSummary
      })
      for (const failure of turnFailures) caseFailures.push(`turn ${index}: ${failure}`)
      if (assertions === 0 && turnError === null) caseFailures.push(`turn ${index}: declared no executed assertion`)
      if (turnError !== null) break
    }

    const after = testCase.after
    if (after) {
      const stored = harness.companion.readConversation({ conversationId: conversation.id }).messages
      if (after.personalityVersionStable === true) {
        const actual = harness.companion.getPersonality().version
        if (actual !== harness.baselineVersion) caseFailures.push(`personality version ${actual} != ${harness.baselineVersion}`)
      }
      if (after.activeMemoryCount !== undefined) {
        const actual = harness.memories.countActive()
        if (actual !== after.activeMemoryCount) caseFailures.push(`active memory count ${actual} != ${after.activeMemoryCount}`)
      }
      const users = stored.filter((message) => message.role === 'user').length
      const assistants = stored.filter((message) => message.role === 'assistant').length
      if (after.storedUserCount !== undefined && users !== after.storedUserCount) {
        caseFailures.push(`stored user messages ${users} != ${after.storedUserCount}`)
      }
      if (after.storedAssistantCount !== undefined && assistants !== after.storedAssistantCount) {
        caseFailures.push(`stored assistant messages ${assistants} != ${after.storedAssistantCount}`)
      }
    }

    return {
      id: testCase.id,
      capability: testCase.capability,
      title: testCase.title,
      passed: caseFailures.length === 0,
      failures: caseFailures,
      assertions: turnResults.reduce((total, turn) => total + turn.assertions, 0),
      turns: turnResults
    }
  } finally {
    harness.close()
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Closed schemas for the same reason as the companion-core dataset: a field the
// runner never reads reads like a guarantee while asserting nothing.
const CASE_KEYS = ['id', 'capability', 'title', 'claims', 'setup', 'turns', 'after', 'realModel'] as const
const SETUP_KEYS = ['memories', 'personality'] as const
const MEMORY_KEYS = ['content', 'sensitivity', 'sourceCategory', 'confidence', 'ageDays', 'confirmed'] as const
const TURN_KEYS = ['content', 'newConversation', 'includeSensitive', 'op', 'expect'] as const
const OP_KEYS = ['type', 'memoryIndex', 'content'] as const
const OP_TYPES = ['correct', 'retract', 'restore', 'delete'] as const
const EXPECT_KEYS = [
  'contextContains', 'contextExcludes', 'historyLength', 'historyRoles', 'lastMessageEquals',
  'memoryEntries', 'memoryEntriesAtMost', 'memoryTopicCount', 'memoryMatchFor', 'memoryNotTopicFor',
  'systemContains', 'personalityVersionStable'
] as const
const MATCH_KEYS = ['contentContains', 'match', 'stale'] as const
const AFTER_KEYS = ['personalityVersionStable', 'activeMemoryCount', 'storedAssistantCount', 'storedUserCount'] as const
const REAL_KEYS = ['check', 'mustMention', 'mustNotMention', 'note', 'judge'] as const
const JUDGE_KEYS = ['current', 'superseded', 'retracted', 'conflicting', 'acceptable', 'expectsAnswer', 'valueRelations'] as const
const REAL_CHECKS = ['substring', 'clarifying_question'] as const
const MATCH_VALUES = ['topic', 'context', 'continuity'] as const

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ContextMemoryEvaluationError(`UNKNOWN_FIELD:${where}:${key}`)
  }
}

function requireStrings(value: unknown, where: string): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}`)
  }
}

function validateExpectation(value: unknown, where: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}`)
  }
  const record = value as Record<string, unknown>
  rejectUnknownKeys(record, EXPECT_KEYS, where)
  if (Object.keys(record).length === 0) {
    // A turn that asserts nothing would pass without testing anything.
    throw new ContextMemoryEvaluationError(`EMPTY_EXPECTATION:${where}`)
  }
  for (const key of ['contextContains', 'contextExcludes', 'historyRoles', 'systemContains', 'memoryNotTopicFor']) {
    requireStrings(record[key], `${where}:${key}`)
  }
  for (const key of ['historyLength', 'memoryEntries', 'memoryEntriesAtMost', 'memoryTopicCount']) {
    const candidate = record[key]
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:${key}`)
    }
  }
  if (record.lastMessageEquals !== undefined && typeof record.lastMessageEquals !== 'string') {
    throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:lastMessageEquals`)
  }
  if (record.memoryMatchFor !== undefined) {
    if (!Array.isArray(record.memoryMatchFor)) throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:memoryMatchFor`)
    for (const entry of record.memoryMatchFor) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:memoryMatchFor`)
      }
      const rule = entry as Record<string, unknown>
      rejectUnknownKeys(rule, MATCH_KEYS, `${where}:memoryMatchFor`)
      if (typeof rule.contentContains !== 'string' || rule.contentContains.length === 0) {
        throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:memoryMatchFor`)
      }
      if (!MATCH_VALUES.includes(rule.match as typeof MATCH_VALUES[number])) {
        throw new ContextMemoryEvaluationError(`INVALID_MATCH:${where}:${String(rule.match)}`)
      }
      if (rule.stale !== undefined && typeof rule.stale !== 'boolean') {
        throw new ContextMemoryEvaluationError(`INVALID_EXPECTATION:${where}:stale`)
      }
    }
  }
}

function validateCase(candidate: Record<string, unknown>, seen: Set<string>): ContextMemoryCapability {
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) throw new ContextMemoryEvaluationError('INVALID_CASE_ID')
  if (seen.has(candidate.id)) throw new ContextMemoryEvaluationError(`DUPLICATE_CASE_ID:${candidate.id}`)
  seen.add(candidate.id)
  rejectUnknownKeys(candidate, CASE_KEYS, candidate.id)
  if (typeof candidate.capability !== 'string' || !CONTEXT_MEMORY_CAPABILITIES.includes(candidate.capability as ContextMemoryCapability)) {
    throw new ContextMemoryEvaluationError(`UNKNOWN_CAPABILITY:${candidate.id}:${String(candidate.capability)}`)
  }
  if (typeof candidate.title !== 'string' || typeof candidate.claims !== 'string') {
    throw new ContextMemoryEvaluationError(`MISSING_CASE_METADATA:${candidate.id}`)
  }
  if (candidate.setup !== undefined) {
    if (candidate.setup === null || typeof candidate.setup !== 'object' || Array.isArray(candidate.setup)) {
      throw new ContextMemoryEvaluationError(`INVALID_SETUP:${candidate.id}`)
    }
    const setup = candidate.setup as Record<string, unknown>
    rejectUnknownKeys(setup, SETUP_KEYS, `${candidate.id}:setup`)
    if (setup.memories !== undefined) {
      if (!Array.isArray(setup.memories)) throw new ContextMemoryEvaluationError(`INVALID_SETUP:${candidate.id}:memories`)
      for (const item of setup.memories) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new ContextMemoryEvaluationError(`INVALID_MEMORY:${candidate.id}`)
        rejectUnknownKeys(item as Record<string, unknown>, MEMORY_KEYS, `${candidate.id}:memory`)
      }
    }
  }
  if (!Array.isArray(candidate.turns) || candidate.turns.length === 0) throw new ContextMemoryEvaluationError(`MISSING_TURNS:${candidate.id}`)
  for (const [index, item] of candidate.turns.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new ContextMemoryEvaluationError(`INVALID_TURN:${candidate.id}`)
    const turn = item as Record<string, unknown>
    rejectUnknownKeys(turn, TURN_KEYS, `${candidate.id}:turn${index}`)
    if (typeof turn.content !== 'string' || turn.content.length === 0) throw new ContextMemoryEvaluationError(`INVALID_TURN:${candidate.id}:${index}`)
    if (turn.op !== undefined) {
      if (turn.op === null || typeof turn.op !== 'object' || Array.isArray(turn.op)) {
        throw new ContextMemoryEvaluationError(`INVALID_OP:${candidate.id}:turn${index}`)
      }
      const op = turn.op as Record<string, unknown>
      rejectUnknownKeys(op, OP_KEYS, `${candidate.id}:turn${index}:op`)
      if (!OP_TYPES.includes(op.type as typeof OP_TYPES[number])) {
        throw new ContextMemoryEvaluationError(`UNKNOWN_OP:${candidate.id}:turn${index}:${String(op.type)}`)
      }
      if (op.memoryIndex !== undefined && (typeof op.memoryIndex !== 'number' || !Number.isSafeInteger(op.memoryIndex) || op.memoryIndex < 0)) {
        throw new ContextMemoryEvaluationError(`INVALID_OP:${candidate.id}:turn${index}:memoryIndex`)
      }
      if (op.type === 'correct' && (typeof op.content !== 'string' || op.content.length === 0)) {
        throw new ContextMemoryEvaluationError(`INVALID_OP:${candidate.id}:turn${index}:content`)
      }
    }
    validateExpectation(turn.expect, `${candidate.id}:turn${index}`)
  }
  if (candidate.after !== undefined) {
    if (candidate.after === null || typeof candidate.after !== 'object' || Array.isArray(candidate.after)) {
      throw new ContextMemoryEvaluationError(`INVALID_AFTER:${candidate.id}`)
    }
    rejectUnknownKeys(candidate.after as Record<string, unknown>, AFTER_KEYS, `${candidate.id}:after`)
  }
  if (candidate.realModel !== undefined && candidate.realModel !== null) {
    if (typeof candidate.realModel !== 'object' || Array.isArray(candidate.realModel)) {
      throw new ContextMemoryEvaluationError(`INVALID_REAL_MODEL:${candidate.id}`)
    }
    const spec = candidate.realModel as Record<string, unknown>
    rejectUnknownKeys(spec, REAL_KEYS, `${candidate.id}:realModel`)
    if (!REAL_CHECKS.includes(spec.check as typeof REAL_CHECKS[number])) {
      throw new ContextMemoryEvaluationError(`INVALID_REAL_CHECK:${candidate.id}`)
    }
    requireStrings(spec.mustMention, `${candidate.id}:realModel:mustMention`)
    requireStrings(spec.mustNotMention, `${candidate.id}:realModel:mustNotMention`)
    if (spec.check === 'substring' && (spec.mustMention === undefined) && (spec.mustNotMention === undefined)) {
      throw new ContextMemoryEvaluationError(`EMPTY_REAL_CHECK:${candidate.id}`)
    }
    if (spec.judge !== undefined) {
      if (spec.judge === null || typeof spec.judge !== 'object' || Array.isArray(spec.judge)) {
        throw new ContextMemoryEvaluationError(`INVALID_JUDGE:${candidate.id}`)
      }
      const judge = spec.judge as Record<string, unknown>
      rejectUnknownKeys(judge, JUDGE_KEYS, `${candidate.id}:realModel:judge`)
      for (const key of ['current', 'superseded', 'retracted', 'conflicting', 'acceptable']) {
        requireStrings(judge[key], `${candidate.id}:realModel:judge:${key}`)
      }
      if (judge.expectsAnswer !== undefined && typeof judge.expectsAnswer !== 'boolean') {
        throw new ContextMemoryEvaluationError(`INVALID_JUDGE:${candidate.id}`)
      }
      if (judge.valueRelations !== undefined) {
        if (judge.valueRelations === null || typeof judge.valueRelations !== 'object' || Array.isArray(judge.valueRelations)) {
          throw new ContextMemoryEvaluationError(`INVALID_JUDGE:${candidate.id}`)
        }
        for (const [value, relations] of Object.entries(judge.valueRelations as Record<string, unknown>)) {
          if (value.length === 0) throw new ContextMemoryEvaluationError(`INVALID_JUDGE:${candidate.id}`)
          requireStrings(relations, `${candidate.id}:realModel:judge:valueRelations:${value}`)
        }
      }
      // A judge with no dimension would silently pass everything.
      const declared = ['current', 'superseded', 'retracted', 'conflicting']
        .some((key) => Array.isArray(judge[key]) && (judge[key] as unknown[]).length > 0)
      if (!declared && judge.expectsAnswer !== true) {
        throw new ContextMemoryEvaluationError(`EMPTY_JUDGE:${candidate.id}`)
      }
    }
  }
  return candidate.capability as ContextMemoryCapability
}

export function parseContextMemoryDataset(value: unknown): ContextMemoryDataset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ContextMemoryEvaluationError('INVALID_DATASET')
  const record = value as Record<string, unknown>
  rejectUnknownKeys(record, ['schemaVersion', 'id', 'description', 'cases'], 'dataset')
  if (record.schemaVersion !== 1) throw new ContextMemoryEvaluationError('UNSUPPORTED_SCHEMA')
  if (typeof record.id !== 'string' || !Array.isArray(record.cases) || record.cases.length === 0) {
    throw new ContextMemoryEvaluationError('INVALID_DATASET')
  }
  const seen = new Set<string>()
  const cases = record.cases.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new ContextMemoryEvaluationError('INVALID_CASE')
    const candidate = entry as Record<string, unknown>
    validateCase(candidate, seen)
    return candidate as unknown as ContextMemoryCase
  })
  return {
    schemaVersion: 1,
    id: record.id,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    cases
  }
}

export async function runContextMemoryEvaluation(dataset: ContextMemoryDataset): Promise<ContextMemoryReport> {
  const first: ContextMemoryCaseResult[] = []
  for (const testCase of dataset.cases) first.push(await runCase(testCase))
  const replay: ContextMemoryCaseResult[] = []
  for (const testCase of dataset.cases) replay.push(await runCase(testCase))

  const resultHash = createHash('sha256').update(canonicalJson(first)).digest('hex')
  const replayHash = createHash('sha256').update(canonicalJson(replay)).digest('hex')
  const replayStable = resultHash === replayHash

  const byCapability: ContextMemoryReport['metrics']['byCapability'] = {}
  for (const capability of CONTEXT_MEMORY_CAPABILITIES) {
    const cases = first.filter((item) => item.capability === capability)
    byCapability[capability] = {
      cases: cases.length,
      passed: cases.filter((item) => item.passed).length,
      failed: cases.filter((item) => !item.passed).length,
      assertions: cases.reduce((total, item) => total + item.assertions, 0)
    }
  }

  const failedChecks: string[] = []
  for (const item of first) if (!item.passed) failedChecks.push(item.id)
  const uncovered = Object.entries(byCapability).filter(([, value]) => value.cases === 0).map(([key]) => key)
  if (uncovered.length > 0) failedChecks.push(`uncovered_capabilities:${uncovered.join(',')}`)
  const silent = first.filter((item) => item.assertions === 0).map((item) => item.id)
  if (silent.length > 0) failedChecks.push(`cases_without_assertions:${silent.join(',')}`)
  if (!replayStable) failedChecks.push('deterministic_replay')

  return {
    dataset: { id: dataset.id, caseCount: dataset.cases.length, schemaVersion: dataset.schemaVersion },
    evidenceClass: 'offline_deterministic_stub',
    measures: 'context_delivery',
    modelUnderstanding: 'not_assessed',
    gate: { passed: failedChecks.length === 0, failedChecks },
    metrics: {
      cases: first.length,
      passed: first.filter((item) => item.passed).length,
      failed: first.filter((item) => !item.passed).length,
      assertionsExecuted: first.reduce((total, item) => total + item.assertions, 0),
      byCapability
    },
    determinism: { resultHash, replayStable },
    offlineExecution: {
      providerClass: 'deterministic_stub',
      stubDispatches: dataset.cases.reduce((total, testCase) => total + testCase.turns.length, 0),
      networkCalls: 0
    },
    cases: first
  }
}

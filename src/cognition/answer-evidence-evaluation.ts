/**
 * Answer evaluation, Phase 2.1.
 *
 * The evaluator reports six independent dimensions instead of one string-match
 * verdict, because "the value appears" and "the answer is faithful" are
 * different claims:
 *
 *   evidenceMentioned        does the reply name a delivered value
 *   polarityConsistent       is the affirmative/negative sense preserved
 *   temporalConsistent       is the stated time range preserved
 *   conflictAcknowledged     when two entries disagree, does the reply say so
 *   answersCurrentQuestion   does the reply address what was asked
 *   uncertaintyAppropriate   without usable evidence, is uncertainty admitted
 *
 * Every dimension can be `unscored` with a stable reason code. A dimension is
 * never `pass` by default: absence of evidence is not evidence of correctness.
 *
 * The legacy `outcome` field is still produced (and is derived from the
 * dimensions), so stored records and the Phase-2 report stay readable.
 */
import { readFactSlot, type FactSlot } from '../memory/fact-slot'

export const ANSWER_EVALUATION_SCHEMA_VERSION = 2 as const

export type EvidenceUseOutcome =
  | 'used_correctly'
  | 'delivered_not_used'
  | 'used_wrong_or_stale'
  | 'contradicts_evidence'
  | 'reasonable_unknown'
  | 'unsupported_answer'
  | 'not_scorable'

export type DimensionStatus = 'pass' | 'fail' | 'unscored'

export interface DimensionResult {
  status: DimensionStatus
  /** Stable code, safe to log: never the reply text itself. */
  reason: string
}

export interface EvidenceDimensions {
  evidenceMentioned: DimensionResult
  polarityConsistent: DimensionResult
  temporalConsistent: DimensionResult
  conflictAcknowledged: DimensionResult
  answersCurrentQuestion: DimensionResult
  uncertaintyAppropriate: DimensionResult
}

export const EVIDENCE_DIMENSIONS = [
  'evidenceMentioned',
  'polarityConsistent',
  'temporalConsistent',
  'conflictAcknowledged',
  'answersCurrentQuestion',
  'uncertaintyAppropriate'
] as const

export interface EvaluatedMemory {
  id: string
  content: string
  status?: 'active' | 'unresolved'
  conflictWith?: string[]
}

export interface AnswerEvidenceAssessment {
  schemaVersion: typeof ANSWER_EVALUATION_SCHEMA_VERSION
  outcome: EvidenceUseOutcome
  scored: boolean
  dimensions: EvidenceDimensions
  evidenceIds: string[]
  matchedEvidenceIds: string[]
  /** Delivered entries whose stated value the reply contradicts. */
  contradictedEvidenceIds: string[]
  /** Delivered entries whose conflict the reply failed to acknowledge. */
  unacknowledgedConflictIds: string[]
  /** Stable code, safe to log: never the reply text itself. */
  detail: string
}

export interface AnswerEvaluationInput {
  reply: string
  callSucceeded: boolean
  memories: readonly EvaluatedMemory[]
  /** The user's turn, when available: used for the topic dimension. */
  question?: string
  /** Terms a correct answer must contain, when the caller knows them. */
  expectedAnswerTerms?: readonly string[]
  /** Caller-supplied fabrication probe for an evidence-free reply. */
  fabricationPattern?: RegExp
  /** Distinguishes a failed call from a cancelled one. */
  callOutcome?: 'succeeded' | 'failed' | 'cancelled'
}

const UNKNOWN_MARKERS = /(?:不知道|不确定|无法确定|不清楚|没有(?:相关)?(?:的)?(?:关于[^，。！？]{0,12})?(?:记忆|记录|信息|资料)|没(?:有)?提到|未提及|暂时没有|无法回答|无法确认|没有找到|i (?:do not|don't) know|not sure|no (?:saved )?(?:memory|record|information)|cannot (?:tell|answer|confirm)|unable to (?:tell|answer|confirm))/iu
const REFUSAL_MARKERS = /(?:抱歉|不好意思|我无法|我不能|恕我|sorry|i can(?:not|'t))/iu
const CONFLICT_MARKERS = /(?:冲突|不一致|矛盾|两个版本|两种说法|说法不同|记录不一致|以哪个为准|哪个是|conflict|inconsistent|contradict|which one|two versions)/iu
const NEGATION_BEFORE = /(?:不|没|无|并非|未)[^，。！？；\s]{0,2}$/u
const PAST_MARKERS = /(?:以前|曾经|过去|去年|前年|之前|当年|小时候)/u
const PRESENT_MARKERS = /(?:现在|目前|如今|当前|眼下)/u
const SPECIFIC_FACT = /(?:\d{2,}|[A-Za-z0-9]{3,}|(?:叫|名为|名字是|住在|现居)\s*\S+)/u

const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were', 'will', 'your', 'about', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个', '什么', '怎么', '哪', '吗', '呢'])

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function slotOf(content: string): FactSlot | null {
  return readFactSlot(content)
}

/**
 * The value a memory states. Facts without a readable predicate (a pet's name,
 * for example) fall back to a distinctive token: a bigram that repeats inside
 * the memory ("咪咪") or a long latin/digit token. Without this fallback every
 * name-like memory was permanently unscorable.
 */
function statedValue(content: string): string {
  const slot = slotOf(content)
  // A known predicate whose value cannot be read (a question, a hypothesis, a
  // two-state sentence) must stay unreadable: falling back to a generic token
  // such as 过敏 would make a mixed-time memory look usable.
  if (slot) return slot.value.length > 0 ? normalize(slot.value) : ''
  const normalized = normalize(content)
  // A name marker is the strongest signal: "养了一只叫咪咪的猫".
  // Stop at 的/了 so "叫咪咪的猫" yields 咪咪, not the whole phrase.
  const named = /(?:叫|名字是|名为)\s*([^\s，。！？的了]{1,10})/u.exec(normalized)
  if (named?.[1] && !/^(?:什么|啥|谁)$/u.test(named[1])) return named[1]
  const counts = new Map<string, number>()
  const characters = Array.from(normalized)
  for (let index = 0; index < characters.length - 1; index += 1) {
    const pair = characters[index]! + characters[index + 1]!
    if (!/\p{Script=Han}{2}/u.test(pair)) continue
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).sort((left, right) => right[1] - left[1])[0]
  if (repeated) return repeated[0]
  const latin = normalized.match(/[a-z0-9]{3,}/gu)
  return latin?.[0] ?? ''
}

/** Every position of the value, so one negated mention cannot hide another. */
function mentions(reply: string, value: string): number[] {
  if (value.length === 0) return []
  const positions: number[] = []
  let at = reply.indexOf(value)
  while (at >= 0) {
    positions.push(at)
    at = reply.indexOf(value, at + 1)
  }
  return positions
}

/**
 * Polarity around one mention. The negation can precede the object
 * ("不对花生过敏") or follow it ("花生不引起过敏"), so both sides are checked.
 * A mention with no adjacent negation counts as asserted.
 */
function negatedAt(reply: string, at: number, length: number): boolean {
  const before = reply.slice(Math.max(0, at - 5), at)
  if (NEGATION_BEFORE.test(before)) return true
  const after = reply.slice(at + length, at + length + 4)
  return /^(?:[^，。！？；\s]{0,2})(?:不|没|无)/u.test(after)
}

/** Time words attached to the mention, not anywhere in a long reply. */
function timeAround(reply: string, at: number, length: number): { past: boolean; present: boolean } {
  // The window has to cover the predicate phrase, not just the object: in
  // "你对花生的过敏已经过去了" the time word sits 8 characters after 花生.
  const window = reply.slice(Math.max(0, at - 12), at + length + 12)
  return { past: PAST_MARKERS.test(window), present: PRESENT_MARKERS.test(window) }
}

function contentTerms(value: string): string[] {
  const normalized = normalize(value)
  const terms = new Set<string>()
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0]
    if (token.length > 1 && !stopWords.has(token)) terms.add(token)
    const characters = Array.from(token)
    if (characters.length >= 2 && /\p{Script=Han}/u.test(token)) {
      for (let index = 0; index < characters.length - 1; index += 1) {
        const pair = characters[index]! + characters[index + 1]!
        if (!stopWords.has(pair)) terms.add(pair)
      }
    }
  }
  return [...terms]
}

interface ConflictGroup {
  ids: string[]
  values: string[]
}

/** Groups of delivered entries that state different values for one fact. */
function conflictGroups(memories: readonly EvaluatedMemory[]): ConflictGroup[] {
  const groups: ConflictGroup[] = []
  const seen = new Set<string>()
  for (const memory of memories) {
    if (memory.status !== 'unresolved' && (memory.conflictWith?.length ?? 0) === 0) continue
    const key = [memory.id, ...(memory.conflictWith ?? [])].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const ids = [memory.id, ...(memory.conflictWith ?? [])]
    const values = ids
      .map((id) => memories.find((item) => item.id === id))
      .filter((item): item is EvaluatedMemory => Boolean(item))
      .map((item) => statedValue(item.content))
      .filter((value) => value.length > 0)
    if (values.length >= 2) groups.push({ ids, values })
  }
  return groups
}

function assessEvidenceMentioned(reply: string, memories: readonly EvaluatedMemory[]): { result: DimensionResult; matched: string[] } {
  if (memories.length === 0) return { result: { status: 'unscored', reason: 'no_evidence_delivered' }, matched: [] }
  const readable = memories.filter((memory) => statedValue(memory.content).length > 0)
  if (readable.length === 0) return { result: { status: 'unscored', reason: 'evidence_unreadable' }, matched: [] }
  const matched = readable.filter((memory) => mentions(reply, statedValue(memory.content)).length > 0).map((memory) => memory.id)
  return matched.length > 0
    ? { result: { status: 'pass', reason: 'delivered_value_named' }, matched }
    : { result: { status: 'fail', reason: 'delivered_value_absent' }, matched: [] }
}

function assessPolarity(reply: string, memories: readonly EvaluatedMemory[], matched: string[]): { result: DimensionResult; contradicted: string[] } {
  if (matched.length === 0) return { result: { status: 'unscored', reason: 'no_value_named' }, contradicted: [] }
  const contradicted: string[] = []
  for (const memory of memories) {
    if (!matched.includes(memory.id)) continue
    const slot = slotOf(memory.content)
    if (!slot || slot.kind === 'uncertain' || slot.kind === 'question') continue
    const value = statedValue(memory.content)
    const positions = mentions(reply, value)
    if (positions.length === 0) continue
    const negatedInReply = positions.every((at) => negatedAt(reply, at, value.length))
    if (negatedInReply !== (slot.kind === 'negated')) contradicted.push(memory.id)
  }
  return contradicted.length > 0
    ? { result: { status: 'fail', reason: 'reply_polarity_opposes_evidence' }, contradicted }
    : { result: { status: 'pass', reason: 'polarity_matches' }, contradicted: [] }
}

function assessTemporal(reply: string, memories: readonly EvaluatedMemory[], matched: string[]): DimensionResult {
  if (matched.length === 0) return { status: 'unscored', reason: 'no_value_named' }
  let checked = 0
  for (const memory of memories) {
    if (!matched.includes(memory.id)) continue
    const slot = slotOf(memory.content)
    if (!slot || slot.time === 'mixed') continue
    const value = statedValue(memory.content)
    for (const at of mentions(reply, value)) {
      const around = timeAround(reply, at, value.length)
      if (slot.time === 'past' && around.present && !around.past) return { status: 'fail', reason: 'reply_shifts_past_to_present' }
      // An undated or current statement is read as current, so attaching it to
      // a past-only frame ("你过去说…") changes what was stored.
      if (slot.time !== 'past' && around.past && !around.present) return { status: 'fail', reason: 'reply_shifts_present_to_past' }
      checked += 1
    }
  }
  return checked === 0
    ? { status: 'unscored', reason: 'evidence_time_mixed' }
    : { status: 'pass', reason: 'time_matches' }
}

function assessConflict(reply: string, groups: ConflictGroup[]): { result: DimensionResult; unacknowledged: string[] } {
  if (groups.length === 0) return { result: { status: 'unscored', reason: 'no_conflict_delivered' }, unacknowledged: [] }
  const group = groups[0]!
  const named = group.values.filter((value) => reply.includes(value))
  if (named.length === group.values.length) return { result: { status: 'pass', reason: 'both_sides_named' }, unacknowledged: [] }
  if (CONFLICT_MARKERS.test(reply)) return { result: { status: 'pass', reason: 'conflict_stated' }, unacknowledged: [] }
  if (named.length > 0) return { result: { status: 'fail', reason: 'silently_picked_one_side' }, unacknowledged: group.ids }
  return { result: { status: 'fail', reason: 'conflict_ignored' }, unacknowledged: group.ids }
}

function assessQuestion(input: AnswerEvaluationInput, reply: string, memories: readonly EvaluatedMemory[]): DimensionResult {
  if (input.expectedAnswerTerms && input.expectedAnswerTerms.length > 0) {
    const terms = input.expectedAnswerTerms.map((term) => normalize(term))
    return terms.some((term) => reply.includes(term))
      ? { status: 'pass', reason: 'expected_answer_present' }
      : { status: 'fail', reason: 'expected_answer_absent' }
  }
  if (!input.question) return { status: 'unscored', reason: 'no_question_supplied' }
  const questionTerms = contentTerms(input.question).filter((term) => !memories.some((memory) => statedValue(memory.content) === term))
  if (questionTerms.length === 0) return { status: 'unscored', reason: 'question_has_no_content_terms' }
  return questionTerms.some((term) => reply.includes(term))
    ? { status: 'pass', reason: 'topic_overlap' }
    : { status: 'fail', reason: 'reply_off_topic' }
}

function assessUncertainty(input: AnswerEvaluationInput, reply: string, mentioned: DimensionStatus): DimensionResult {
  if (mentioned === 'pass') return { status: 'unscored', reason: 'evidence_used' }
  if (UNKNOWN_MARKERS.test(reply) || REFUSAL_MARKERS.test(reply)) return { status: 'pass', reason: 'uncertainty_admitted' }
  if (input.fabricationPattern?.test(input.reply)) return { status: 'fail', reason: 'specific_fact_without_evidence' }
  if (SPECIFIC_FACT.test(reply)) return { status: 'fail', reason: 'specific_fact_without_evidence' }
  return { status: 'fail', reason: 'no_evidence_no_admission' }
}

export function evaluateAnswerEvidence(input: AnswerEvaluationInput): AnswerEvidenceAssessment {
  const evidenceIds = input.memories.map((memory) => memory.id)
  const reply = normalize(input.reply)
  const empty = {
    schemaVersion: ANSWER_EVALUATION_SCHEMA_VERSION,
    evidenceIds,
    matchedEvidenceIds: [] as string[],
    contradictedEvidenceIds: [] as string[],
    unacknowledgedConflictIds: [] as string[]
  }

  if (!input.callSucceeded) {
    const cancelled = input.callOutcome === 'cancelled'
    const dimensions: EvidenceDimensions = {
      evidenceMentioned: { status: 'unscored', reason: 'call_not_completed' },
      polarityConsistent: { status: 'unscored', reason: 'call_not_completed' },
      temporalConsistent: { status: 'unscored', reason: 'call_not_completed' },
      conflictAcknowledged: { status: 'unscored', reason: 'call_not_completed' },
      answersCurrentQuestion: { status: 'unscored', reason: 'call_not_completed' },
      uncertaintyAppropriate: { status: 'unscored', reason: 'call_not_completed' }
    }
    return { ...empty, outcome: 'not_scorable', scored: false, dimensions, detail: cancelled ? 'provider_call_cancelled' : 'provider_call_failed' }
  }

  const mention = assessEvidenceMentioned(reply, input.memories)
  const polarity = assessPolarity(reply, input.memories, mention.matched)
  const temporal = assessTemporal(reply, input.memories, mention.matched)
  const groups = conflictGroups(input.memories)
  const conflict = assessConflict(reply, groups)
  const question = assessQuestion(input, reply, input.memories)
  const uncertainty = assessUncertainty(input, reply, mention.result.status)

  const dimensions: EvidenceDimensions = {
    evidenceMentioned: mention.result,
    polarityConsistent: polarity.result,
    temporalConsistent: temporal,
    conflictAcknowledged: conflict.result,
    answersCurrentQuestion: question,
    uncertaintyAppropriate: uncertainty
  }

  const base = {
    ...empty,
    dimensions,
    matchedEvidenceIds: mention.matched,
    contradictedEvidenceIds: polarity.contradicted,
    unacknowledgedConflictIds: conflict.unacknowledged
  }

  // Precedence: a call that never happened is not a model verdict; a silently
  // resolved conflict is the most specific failure; then a reversed fact; then
  // a used entry; then the no-evidence cases.
  if (conflict.result.status === 'fail') {
    return { ...base, outcome: 'used_wrong_or_stale', scored: true, detail: conflict.result.reason }
  }
  if (polarity.result.status === 'fail') {
    return { ...base, outcome: 'contradicts_evidence', scored: true, detail: polarity.result.reason }
  }
  if (temporal.status === 'fail') {
    return { ...base, outcome: 'contradicts_evidence', scored: true, detail: temporal.reason }
  }
  if (mention.result.status === 'pass') {
    // Naming the value is not the same as answering with it. A reply that asks
    // the question back, or that never addresses what was asked, is counted as
    // evidence delivered but not used — otherwise a反问 looked like success.
    // A clarifying question about a delivered conflict is the required
    // behaviour, so only a question that does not acknowledge the conflict
    // counts as asking back.
    const asksBack = /[?？]\s*$/u.test(input.reply.trim()) && conflict.result.status !== 'pass'
    if (asksBack) {
      return { ...base, outcome: 'delivered_not_used', scored: true, detail: 'evidence_named_but_reply_is_question' }
    }
    // When the reply acknowledges the conflict, asking which value is current
    // *is* the answer to a question about a fact with two stored versions.
    if (question.status === 'fail' && conflict.result.status !== 'pass') {
      return { ...base, outcome: 'delivered_not_used', scored: true, detail: 'evidence_named_but_question_unanswered' }
    }
    return { ...base, outcome: 'used_correctly', scored: true, detail: 'delivered_value_used' }
  }
  if (input.memories.length === 0) {
    return uncertainty.status === 'pass'
      ? { ...base, outcome: 'reasonable_unknown', scored: true, detail: uncertainty.reason }
      : { ...base, outcome: uncertainty.reason === 'no_evidence_no_admission' ? 'not_scorable' : 'unsupported_answer', scored: uncertainty.reason !== 'no_evidence_no_admission', detail: uncertainty.reason }
  }
  // Evidence was delivered but no entry could be read: the evaluator cannot
  // tell whether the reply used it, so it must not claim either way.
  if (mention.result.status === 'unscored') {
    return { ...base, outcome: 'not_scorable', scored: false, detail: mention.result.reason }
  }
  return { ...base, outcome: 'delivered_not_used', scored: true, detail: 'evidence_delivered_but_absent' }
}

export function isAnswerEvidenceAssessment(value: unknown): value is AnswerEvidenceAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!['used_correctly', 'delivered_not_used', 'used_wrong_or_stale', 'contradicts_evidence', 'reasonable_unknown', 'unsupported_answer', 'not_scorable'].includes(String(record.outcome))) return false
  if (typeof record.scored !== 'boolean') return false
  if (!Array.isArray(record.evidenceIds) || !Array.isArray(record.matchedEvidenceIds) || !Array.isArray(record.contradictedEvidenceIds)) return false
  if (typeof record.detail !== 'string' || record.detail.length > 64) return false
  if (record.dimensions !== undefined) {
    const dimensions = record.dimensions as Record<string, unknown>
    for (const key of EVIDENCE_DIMENSIONS) {
      const entry = dimensions[key] as Record<string, unknown> | undefined
      if (!entry || !['pass', 'fail', 'unscored'].includes(String(entry.status))) return false
      if (typeof entry.reason !== 'string' || !/^[a-z_]{3,48}$/u.test(entry.reason)) return false
    }
  }
  return true
}

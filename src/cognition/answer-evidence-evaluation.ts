/**
 * Answer evaluation, Phase 2.1.1 (schema 3).
 *
 * The evaluator reports independent dimensions instead of one string-match
 * verdict, because "the value appears", "the answer is faithful", "the conflict
 * was handled" and "the reply admits uncertainty" fail for different reasons:
 *
 *   evidenceMentioned        does the reply name a delivered value
 *   polarityConsistent       is the affirmative/negative sense preserved
 *   temporalConsistent       is the stated time range preserved
 *   conflictAcknowledged     were the delivered conflicts handled (derived)
 *   answersCurrentQuestion   does the reply address what was asked
 *   uncertaintyExpressed     does the reply say it is unsure
 *   unsupportedClaimDetected does it state a specific fact with no evidence
 *   uncertaintyAppropriate   is the uncertainty consistent with the evidence
 *
 * Two behaviours are deliberately separated: expressing uncertainty and not
 * inventing a fact. "抱歉，我不确定，但你的车牌号是京A12345" expresses
 * uncertainty *and* invents a plate number; the previous evaluator scored it as
 * a reasonable admission because it matched 不确定.
 *
 * Conflict handling is scored per delivered conflict group, and needs more than
 * the word 冲突: the reply must name both values and either explain that they
 * disagree or ask which one is current.
 */
import { readFactSlot, type FactSlot } from '../memory/fact-slot'

export const ANSWER_EVALUATION_SCHEMA_VERSION = 3 as const

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
  uncertaintyExpressed: DimensionResult
  unsupportedClaimDetected: DimensionResult
  uncertaintyAppropriate: DimensionResult
}

export const EVIDENCE_DIMENSIONS = [
  'evidenceMentioned',
  'polarityConsistent',
  'temporalConsistent',
  'conflictAcknowledged',
  'answersCurrentQuestion',
  'uncertaintyExpressed',
  'unsupportedClaimDetected',
  'uncertaintyAppropriate'
] as const

export type ConflictGroupOutcome = 'pass' | 'fail' | 'unscored'

export interface ConflictGroupAssessment {
  memoryIds: string[]
  values: string[]
  predicate: string
  /** The group concerns the fact the question asks about. */
  relevant: boolean
  mentioned: boolean
  valuesIdentified: boolean
  relationshipExplained: boolean
  unsupportedSideSelected: boolean
  clarificationRequested: boolean
  outcome: ConflictGroupOutcome
  reason: string
}

export interface ConflictAssessment {
  groups: ConflictGroupAssessment[]
  outcome: ConflictGroupOutcome
  reason: string
}

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
  scoring: { status: 'scored' | 'unscored'; reason: string }
  dimensions: EvidenceDimensions
  conflict: ConflictAssessment
  evidenceIds: string[]
  matchedEvidenceIds: string[]
  /** Delivered entries whose stated value the reply contradicts. */
  contradictedEvidenceIds: string[]
  /** Delivered entries whose conflict the reply failed to handle. */
  unacknowledgedConflictIds: string[]
  /** Stable code, safe to log: never the reply text itself. */
  detail: string
}

export interface AnswerEvaluationInput {
  reply: string
  callSucceeded: boolean
  memories: readonly EvaluatedMemory[]
  /** The user's turn, when available: used for the topic and conflict checks. */
  question?: string
  /** Terms a correct answer must contain, when the caller knows them. */
  expectedAnswerTerms?: readonly string[]
  /** Caller-supplied fabrication probe for an evidence-free reply. */
  fabricationPattern?: RegExp
  /** Distinguishes a failed call from a cancelled one. */
  callOutcome?: 'succeeded' | 'failed' | 'cancelled'
}

const UNKNOWN_MARKERS = /(?:不知道|不确定|无法确定|不清楚|没(?:有)?(?:相关)?(?:的)?(?:关于[^，。！？]{0,12})?(?:记忆|记录|信息|资料)|没(?:有)?提到|未提及|暂时没有|无法回答|无法确认|没有找到|i (?:do not|don't) know|not sure|no (?:saved )?(?:memory|record|information)|cannot (?:tell|answer|confirm)|unable to (?:tell|answer|confirm))/iu
const CONFLICT_MARKERS = /(?:冲突|不一致|矛盾|两个版本|两种说法|说法不同|记录不一致|以哪个为准|哪个是|conflict|inconsistent|contradict|which one|two versions)/iu
const CLARIFICATION_MARKERS = /(?:哪个|哪一种|哪一个|以哪个为准|是否仍然|现在住|以什么为准|请你确认|确认一下|which one|which is current|can you confirm)/iu
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
 * for example) fall back to a distinctive token: a name marker, a bigram that
 * repeats inside the memory ("咪咪"), or a long latin/digit token.
 */
function statedValue(content: string): string {
  const slot = slotOf(content)
  // A known predicate whose value cannot be read (a question, a hypothesis, a
  // two-state sentence) must stay unreadable: falling back to a generic token
  // such as 过敏 would make a mixed-time memory look usable.
  if (slot) return slot.value.length > 0 ? normalize(slot.value) : ''
  const normalized = normalize(content)
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
 */
function negatedAt(reply: string, at: number, length: number): boolean {
  const before = reply.slice(Math.max(0, at - 5), at)
  if (NEGATION_BEFORE.test(before)) return true
  const after = reply.slice(at + length, at + length + 4)
  return /^(?:[^，。！？；\s]{0,2})(?:不|没|无)/u.test(after)
}

/** Time words attached to the mention, not anywhere in a long reply. */
function timeAround(reply: string, at: number, length: number): { past: boolean; present: boolean; reported: boolean } {
  // The window has to cover the predicate phrase: in "你对花生的过敏已经过去
  // 了" the time word sits 8 characters after 花生.
  const window = reply.slice(Math.max(0, at - 12), at + length + 12)
  // "你之前说住在杭州" refers to when the user said it, not to a past state of
  // the fact, so it is reported speech rather than a time shift.
  return {
    past: PAST_MARKERS.test(window),
    present: PRESENT_MARKERS.test(window),
    reported: /(?:说|提到|告诉|讲过)/u.test(window)
  }
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
  predicate: string
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
    const entries = ids
      .map((id) => memories.find((item) => item.id === id))
      .filter((item): item is EvaluatedMemory => Boolean(item))
    const values = entries.map((item) => statedValue(item.content)).filter((value) => value.length > 0)
    if (values.length < 2) continue
    const predicates = [...new Set(entries.map((item) => slotOf(item.content)?.predicate).filter((value): value is NonNullable<typeof value> => Boolean(value)))]
    groups.push({ ids, values, predicate: predicates[0] ?? 'unknown' })
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
      if (around.reported) continue
      if (slot.time === 'past' && around.present && !around.past) return { status: 'fail', reason: 'reply_shifts_past_to_present' }
      // An undated or current statement is read as current, so attaching it to
      // a past-only frame ("你过去说…") changes what was stored.
      if (slot.time !== 'past' && around.past && !around.present) return { status: 'fail', reason: 'reply_shifts_present_to_past' }
      checked += 1
    }
  }
  return checked === 0 ? { status: 'unscored', reason: 'evidence_time_mixed' } : { status: 'pass', reason: 'time_matches' }
}

function assessConflictGroup(reply: string, group: ConflictGroup): ConflictGroupAssessment {
  const named = group.values.filter((value) => reply.includes(value))
  const hasMarker = CONFLICT_MARKERS.test(reply)
  const asksWhich = CLARIFICATION_MARKERS.test(reply) && /[?？]/u.test(reply)
  const valuesIdentified = named.length >= 2
  // "两种说法不一致" without naming them is not enough to prove the model
  // understood which facts disagree.
  const relationshipExplained = hasMarker && valuesIdentified
  const clarificationRequested = asksWhich && (valuesIdentified || hasMarker)
  const unsupportedSideSelected = named.length === 1 && !hasMarker

  let outcome: ConflictGroupOutcome = 'fail'
  let reason = 'conflict_ignored'
  if (relationshipExplained) {
    outcome = 'pass'
    reason = 'both_values_and_relationship'
  } else if (valuesIdentified && clarificationRequested) {
    outcome = 'pass'
    reason = 'both_values_and_clarification'
  } else if (unsupportedSideSelected) {
    reason = 'silently_picked_one_side'
  } else if (valuesIdentified) {
    reason = 'values_listed_without_relationship'
  } else if (hasMarker) {
    reason = 'conflict_claimed_without_values'
  }

  return {
    memoryIds: group.ids,
    values: group.values,
    predicate: group.predicate,
    relevant: true,
    mentioned: named.length > 0 || hasMarker,
    valuesIdentified,
    relationshipExplained,
    unsupportedSideSelected,
    clarificationRequested,
    outcome,
    reason
  }
}

const PREDICATE_MARKERS: Readonly<Record<string, RegExp>> = {
  residence: /住/u,
  employer: /工作|公司|单位/u,
  job_role: /职业|职位|岗位|工作/u,
  study: /学|课程|专业/u,
  preference: /喜欢|偏好|讨厌|兴趣/u,
  goal: /计划|打算|目标/u,
  name: /名字|叫/u,
  age: /岁|年龄/u,
  health: /过敏|健康/u,
  schedule: /安排|日程|会议|出差/u,
  project_code: /代号/u
}

/**
 * A delivered conflict only matters when the question is about that fact. The
 * question's predicate is the strongest signal; a shared value or the predicate
 * marker is the fallback, so an unrelated question never forces the model to
 * discuss a conflict it did not ask about.
 */
function isGroupRelevant(group: ConflictGroup, question: string | undefined, questionPredicate: string | null): boolean {
  if (!question) return true
  if (questionPredicate && group.predicate === questionPredicate) return true
  if (group.values.some((value) => value.length > 0 && normalize(question).includes(value))) return true
  const marker = PREDICATE_MARKERS[group.predicate]
  return marker ? marker.test(question) : group.predicate === 'unknown'
}

function assessConflict(reply: string, groups: ConflictGroup[], question: string | undefined, questionPredicate: string | null): ConflictAssessment {
  if (groups.length === 0) return { groups: [], outcome: 'unscored', reason: 'no_conflict_delivered' }
  const relevant = groups.filter((group) => isGroupRelevant(group, question, questionPredicate))
  const assessed = groups.map((group) => {
    if (!relevant.includes(group)) {
      return { ...assessConflictGroup(reply, group), relevant: false, outcome: 'unscored' as const, reason: 'group_not_relevant_to_question' }
    }
    return assessConflictGroup(reply, group)
  })
  if (relevant.length === 0) return { groups: assessed, outcome: 'unscored', reason: 'no_relevant_conflict' }
  const failed = assessed.find((group) => group.outcome === 'fail')
  if (failed) return { groups: assessed, outcome: 'fail', reason: failed.reason }
  return { groups: assessed, outcome: 'pass', reason: 'all_groups_handled' }
}

function assessQuestion(input: AnswerEvaluationInput, reply: string, memories: readonly EvaluatedMemory[]): DimensionResult {
  const base = (result: DimensionResult): DimensionResult => {
    if (result.status !== 'pass') return result
    // A present-tense question answered with the past state has the topic in
    // common but the wrong time; topic overlap alone must not pass it.
    const queryTime = input.question ? slotOf(input.question)?.time : null
    if (queryTime !== 'present') return result
    const mentionsInReply = memories
      .map((memory) => statedValue(memory.content))
      .filter((value) => value.length > 0)
      .flatMap((value) => mentions(reply, value).map((at) => timeAround(reply, at, value.length)))
      .filter((around) => !around.reported)
    if (mentionsInReply.length === 0) return result
    const allPast = mentionsInReply.every((around) => around.past && !around.present)
    return allPast ? { status: 'fail', reason: 'answer_uses_wrong_time' } : result
  }
  if (input.expectedAnswerTerms && input.expectedAnswerTerms.length > 0) {
    const terms = input.expectedAnswerTerms.map((term) => normalize(term))
    return base(terms.some((term) => reply.includes(term))
      ? { status: 'pass', reason: 'expected_answer_present' }
      : { status: 'fail', reason: 'expected_answer_absent' })
  }
  if (!input.question) return { status: 'unscored', reason: 'no_question_supplied' }
  const questionTerms = contentTerms(input.question).filter((term) => !memories.some((memory) => statedValue(memory.content) === term))
  if (questionTerms.length === 0) return { status: 'unscored', reason: 'question_has_no_content_terms' }
  return base(questionTerms.some((term) => reply.includes(term))
    ? { status: 'pass', reason: 'topic_overlap' }
    : { status: 'fail', reason: 'reply_off_topic' })
}

/** A question about the user is the only place a specific claim is checkable. */
function asksAboutUser(input: AnswerEvaluationInput): boolean {
  if (input.expectedAnswerTerms && input.expectedAnswerTerms.length > 0) return true
  if (!input.question) return false
  return /(?:我|我的)|\b(?:my|mine|i|i'm)\b/iu.test(input.question)
}

function assessUnsupportedClaim(input: AnswerEvaluationInput, reply: string, memories: readonly EvaluatedMemory[]): DimensionResult {
  const deliveredValues = memories.map((memory) => statedValue(memory.content)).filter((value) => value.length > 0)
  if (input.fabricationPattern) {
    const match = input.fabricationPattern.exec(input.reply)
    if (match) {
      const covered = deliveredValues.some((value) => value.length > 0 && normalize(match[0]).includes(value))
      // "我的猫的名字是什么" matches a name pattern but asks, it does not claim.
      const isQuestion = /(?:什么|啥|谁|哪个|哪只|哪一位)/u.test(match[0])
      if (!covered && !isQuestion) return { status: 'fail', reason: 'specific_claim_without_evidence' }
    }
  }
  // A reply that ends in a question is asking, not asserting.
  const replyIsQuestion = /[?？]\s*$/u.test(input.reply.trim())
  if (!replyIsQuestion && deliveredValues.length === 0 && asksAboutUser(input) && SPECIFIC_FACT.test(reply)) {
    return { status: 'fail', reason: 'specific_claim_without_evidence' }
  }
  return { status: 'pass', reason: 'no_unsupported_claim' }
}

function assessUncertainty(
  input: AnswerEvaluationInput,
  reply: string,
  mentioned: DimensionStatus,
  unsupported: DimensionStatus
): { expressed: DimensionResult; appropriate: DimensionResult } {
  const expressed = UNKNOWN_MARKERS.test(reply)
  const expressedResult: DimensionResult = expressed
    ? { status: 'pass', reason: 'uncertainty_expressed' }
    : { status: 'unscored', reason: 'no_uncertainty_language' }

  if (unsupported === 'fail') return { expressed: expressedResult, appropriate: { status: 'fail', reason: 'claim_without_evidence' } }
  if (mentioned === 'pass') return { expressed: expressedResult, appropriate: { status: 'unscored', reason: 'evidence_used' } }
  const delivered = input.memories.some((memory) => statedValue(memory.content).length > 0)
  if (delivered) return { expressed: expressedResult, appropriate: { status: 'fail', reason: 'evidence_available_but_ignored' } }
  return expressed
    ? { expressed: expressedResult, appropriate: { status: 'pass', reason: 'uncertainty_admitted' } }
    : { expressed: expressedResult, appropriate: { status: 'fail', reason: 'no_uncertainty_expressed' } }
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
    const reason = cancelled ? 'provider_call_cancelled' : 'provider_call_failed'
    const unscored: DimensionResult = { status: 'unscored', reason: 'call_not_completed' }
    return {
      ...empty,
      outcome: 'not_scorable',
      scored: false,
      scoring: { status: 'unscored', reason },
      dimensions: {
        evidenceMentioned: unscored,
        polarityConsistent: unscored,
        temporalConsistent: unscored,
        conflictAcknowledged: unscored,
        answersCurrentQuestion: unscored,
        uncertaintyExpressed: unscored,
        unsupportedClaimDetected: unscored,
        uncertaintyAppropriate: unscored
      },
      conflict: { groups: [], outcome: 'unscored', reason },
      detail: reason
    }
  }

  const mention = assessEvidenceMentioned(reply, input.memories)
  const polarity = assessPolarity(reply, input.memories, mention.matched)
  const temporal = assessTemporal(reply, input.memories, mention.matched)
  const questionPredicate = input.question ? slotOf(input.question)?.predicate ?? null : null
  const conflict = assessConflict(reply, conflictGroups(input.memories), input.question, questionPredicate)
  const question = assessQuestion(input, reply, input.memories)
  const unsupported = assessUnsupportedClaim(input, reply, input.memories)
  const uncertainty = assessUncertainty(input, reply, mention.result.status, unsupported.status)

  const dimensions: EvidenceDimensions = {
    evidenceMentioned: mention.result,
    polarityConsistent: polarity.result,
    temporalConsistent: temporal,
    conflictAcknowledged: conflict.outcome === 'unscored'
      ? { status: 'unscored', reason: conflict.reason }
      : conflict.outcome === 'pass'
        ? { status: 'pass', reason: conflict.reason }
        : { status: 'fail', reason: conflict.reason },
    answersCurrentQuestion: question,
    uncertaintyExpressed: uncertainty.expressed,
    unsupportedClaimDetected: unsupported,
    uncertaintyAppropriate: uncertainty.appropriate
  }

  const base = {
    ...empty,
    dimensions,
    conflict,
    matchedEvidenceIds: mention.matched,
    contradictedEvidenceIds: polarity.contradicted,
    unacknowledgedConflictIds: conflict.groups.filter((group) => group.outcome === 'fail').flatMap((group) => group.memoryIds)
  }
  const scored = (outcome: EvidenceUseOutcome, detail: string): AnswerEvidenceAssessment => ({
    ...base,
    outcome,
    scored: true,
    scoring: { status: 'scored', reason: detail },
    detail
  })
  const unscored = (detail: string): AnswerEvidenceAssessment => ({
    ...base,
    outcome: 'not_scorable',
    scored: false,
    scoring: { status: 'unscored', reason: detail },
    detail
  })

  // Precedence: an invented fact is the most specific failure; then a silently
  // resolved conflict; then a reversed fact; then whether the entry was used.
  if (unsupported.status === 'fail') return scored('unsupported_answer', unsupported.reason)
  if (conflict.outcome === 'fail') return scored('used_wrong_or_stale', conflict.reason)
  if (polarity.result.status === 'fail') return scored('contradicts_evidence', polarity.result.reason)
  if (temporal.status === 'fail') return scored('contradicts_evidence', temporal.reason)
  if (mention.result.status === 'pass') {
    // Naming the value is not the same as answering with it. A clarifying
    // question about a conflict is the required behaviour, so it is excluded.
    const asksBack = /[?？]\s*$/u.test(input.reply.trim()) && conflict.outcome !== 'pass'
    if (asksBack) return scored('delivered_not_used', 'evidence_named_but_reply_is_question')
    if (question.status === 'fail' && conflict.outcome !== 'pass') return scored('delivered_not_used', 'evidence_named_but_question_unanswered')
    return scored('used_correctly', 'delivered_value_used')
  }
  if (input.memories.length === 0) {
    if (uncertainty.appropriate.status === 'pass') return scored('reasonable_unknown', 'uncertainty_admitted')
    return unscored('no_evidence_no_admission')
  }
  if (mention.result.status === 'unscored') return unscored(mention.result.reason)
  return scored('delivered_not_used', 'evidence_delivered_but_absent')
}

const OUTCOMES = new Set<string>(['used_correctly', 'delivered_not_used', 'used_wrong_or_stale', 'contradicts_evidence', 'reasonable_unknown', 'unsupported_answer', 'not_scorable'])
const KNOWN_DIMENSIONS = new Set<string>(EVIDENCE_DIMENSIONS)

/**
 * Accepts schema 2 and 3 records: schema 2 has six dimensions, schema 3 adds
 * the uncertainty split and the per-group conflict assessment.
 */
export function isAnswerEvidenceAssessment(value: unknown): value is AnswerEvidenceAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!OUTCOMES.has(String(record.outcome))) return false
  if (typeof record.scored !== 'boolean') return false
  if (!Array.isArray(record.evidenceIds) || !Array.isArray(record.matchedEvidenceIds) || !Array.isArray(record.contradictedEvidenceIds)) return false
  if (typeof record.detail !== 'string' || record.detail.length > 64) return false
  if (record.dimensions !== undefined) {
    if (!record.dimensions || typeof record.dimensions !== 'object') return false
    for (const [key, raw] of Object.entries(record.dimensions as Record<string, unknown>)) {
      if (!KNOWN_DIMENSIONS.has(key)) continue
      const entry = raw as Record<string, unknown> | null
      if (!entry || !['pass', 'fail', 'unscored'].includes(String(entry.status))) return false
      if (typeof entry.reason !== 'string' || !/^[a-z_]{3,48}$/u.test(entry.reason)) return false
    }
  }
  if (record.conflict !== undefined) {
    const conflict = record.conflict as Record<string, unknown> | null
    if (!conflict || !['pass', 'fail', 'unscored'].includes(String(conflict.outcome))) return false
    if (!Array.isArray(conflict.groups)) return false
  }
  return true
}

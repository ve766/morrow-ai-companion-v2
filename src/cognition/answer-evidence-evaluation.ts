/**
 * Answer evaluation, Phase 2.
 *
 * This scores *observable behaviour*: did the reply use a delivered entry, did
 * it ignore it, did it contradict it, or did it admit that the evidence was
 * missing. It never claims to know what the model "reasoned" internally.
 *
 * The six outcomes are deliberately coarse, because a text-level check cannot
 * tell a correct paraphrase from a lucky coincidence:
 *
 *   used_correctly        a delivered value appears, with matching polarity
 *   delivered_not_used    evidence was delivered and nothing from it appears
 *   used_wrong_or_stale   conflicting entries were delivered and the reply
 *                         silently picked one without acknowledging conflict
 *   contradicts_evidence  the delivered value appears with the opposite polarity
 *   reasonable_unknown    no usable evidence and the reply says so
 *   not_scorable          call failure, or no evidence and no admission
 */
import { readFactSlot } from '../memory/fact-slot'

export type EvidenceUseOutcome =
  | 'used_correctly'
  | 'delivered_not_used'
  | 'used_wrong_or_stale'
  | 'contradicts_evidence'
  | 'reasonable_unknown'
  | 'not_scorable'

export interface EvaluatedMemory {
  id: string
  content: string
  status?: 'active' | 'unresolved'
  conflictWith?: string[]
}

export interface AnswerEvidenceAssessment {
  outcome: EvidenceUseOutcome
  scored: boolean
  evidenceIds: string[]
  matchedEvidenceIds: string[]
  /** Delivered entries whose stated value the reply contradicts. */
  contradictedEvidenceIds: string[]
  /** Stable code, safe to log: never the reply text itself. */
  detail: string
}

export interface AnswerEvaluationInput {
  reply: string
  callSucceeded: boolean
  memories: readonly EvaluatedMemory[]
}

const UNKNOWN_MARKERS = /(?:不知道|不确定|无法确定|不清楚|没有(?:相关)?(?:的)?(?:关于[^，。！？]{0,12})?(?:记忆|记录|信息|资料)|没(?:有)?提到|未提及|暂时没有|无法回答|i (?:do not|don't) know|not sure|no (?:saved )?(?:memory|record|information)|cannot (?:tell|answer)|unable to (?:tell|answer))/iu
const CONFLICT_ACKNOWLEDGEMENT = /(?:冲突|不一致|矛盾|两个版本|两种说法|哪个|哪一个|以哪个为准|不确定哪个|conflict|inconsistent|contradict|which one|two versions)/iu
// The negation can sit next to the object ("不对花生过敏") or on the predicate
// ("花生不过敏"), so a short window is used instead of the two characters
// directly in front of the value.
const NEGATION_BEFORE = /(?:不|没|无|并非|未)[^，。！？；\s]{0,2}$/u

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

/** The value a memory states, if the fact layer can read one. */
function statedValue(content: string): string {
  const slot = readFactSlot(content)
  return slot && slot.value.length > 0 ? normalize(slot.value) : ''
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

export function evaluateAnswerEvidence(input: AnswerEvaluationInput): AnswerEvidenceAssessment {
  const evidenceIds = input.memories.map((memory) => memory.id)
  if (!input.callSucceeded) {
    return { outcome: 'not_scorable', scored: false, evidenceIds, matchedEvidenceIds: [], contradictedEvidenceIds: [], detail: 'provider_call_failed' }
  }
  const reply = normalize(input.reply)

  if (input.memories.length === 0) {
    if (UNKNOWN_MARKERS.test(reply)) {
      return { outcome: 'reasonable_unknown', scored: true, evidenceIds, matchedEvidenceIds: [], contradictedEvidenceIds: [], detail: 'no_evidence_admitted' }
    }
    // No evidence and no admission: this is a fabrication *candidate*, but
    // deciding that needs the reply to state a checkable fact. The benchmark
    // scores fabrication separately; here it stays unscored.
    return { outcome: 'not_scorable', scored: false, evidenceIds, matchedEvidenceIds: [], contradictedEvidenceIds: [], detail: 'no_evidence_no_admission' }
  }

  const matched: string[] = []
  const contradicted: string[] = []
  for (const memory of input.memories) {
    const value = statedValue(memory.content)
    const positions = mentions(reply, value)
    if (positions.length === 0) continue
    matched.push(memory.id)
    // Polarity is only checkable where the value is named. If any mention is
    // asserted, the reply is not reading the fact as negated.
    const negatedInReply = positions.every((at) => negatedAt(reply, at, value.length))
    const slot = readFactSlot(memory.content)
    const negatedInMemory = slot?.kind === 'negated'
    if (slot && negatedInReply !== negatedInMemory) contradicted.push(memory.id)
  }

  // Conflict handling: a reply that names exactly one side of a delivered
  // conflict without acknowledging it has silently picked a winner.
  const conflicted = input.memories.filter((memory) => memory.status === 'unresolved' || (memory.conflictWith?.length ?? 0) > 0)
  if (conflicted.length >= 2 && matched.length > 0 && matched.length < conflicted.length && !CONFLICT_ACKNOWLEDGEMENT.test(reply)) {
    return { outcome: 'used_wrong_or_stale', scored: true, evidenceIds, matchedEvidenceIds: matched, contradictedEvidenceIds: [], detail: 'silently_picked_one_of_conflicting_entries' }
  }

  if (contradicted.length > 0) {
    return { outcome: 'contradicts_evidence', scored: true, evidenceIds, matchedEvidenceIds: matched, contradictedEvidenceIds: contradicted, detail: 'reply_polarity_opposes_evidence' }
  }
  if (matched.length > 0) {
    return { outcome: 'used_correctly', scored: true, evidenceIds, matchedEvidenceIds: matched, contradictedEvidenceIds: [], detail: 'delivered_value_used' }
  }
  return { outcome: 'delivered_not_used', scored: true, evidenceIds, matchedEvidenceIds: [], contradictedEvidenceIds: [], detail: 'evidence_delivered_but_absent' }
}

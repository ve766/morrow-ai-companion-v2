/**
 * Pre-response memory operation planner (Stage 4-A final repair, R1–R3).
 *
 * The vertical story failed on timing: the explicit "帮我记住" path ran in the
 * post-reply outbox, so the model answered the correction turn *before* the
 * fact existed and honestly said it could find no record — while the database
 * became correct a moment later. "The database eventually agrees" is not "the
 * model understood this turn".
 *
 * This planner is the deterministic half: it reads the user's own words plus
 * the current fact ledger and decides, before any provider call, whether the
 * turn asks for a save, a correction of one identifiable fact, a clarification
 * (ambiguous target), or nothing at all. The executor (MemoryService) then
 * commits and re-reads; the prompt carries the *verified* result.
 *
 * Deliberately deterministic: no model text becomes a database instruction.
 * The planner may say "correct target X" only when exactly one active fact
 * matches the predicate and the old value is either named or recoverable as a
 * unique referent.
 */
import type { FactRecord } from './fact-memory'
import { extractFactSlots, type FactCandidate, type FactPredicate } from './fact-slot'

export type MemoryOperationKind = 'none' | 'create' | 'correct' | 'clarify' | 'rejected' | 'failed'

export interface PlannedFact {
  predicate: FactPredicate
  value: string
  valueNormalized: string
  polarity: 'positive' | 'negative'
  /** The display text that will be stored as the memory. */
  displayText: string
}

export interface CorrectionTarget {
  memoryId: string
  factId: string
  predicate: FactPredicate
  previousValue: string
  revision: number
}

export type MemoryOperationPlan =
  | { operation: 'none'; reason: string }
  | { operation: 'create'; messageId: string; facts: PlannedFact[]; confidence: number; decisionReason: string }
  | { operation: 'correct'; messageId: string; target: CorrectionTarget; newValue: string; displayText: string; confidence: number; decisionReason: string }
  | { operation: 'clarify'; messageId: string; reason: string; candidates: Array<{ value: string; memoryId: string }> }
  | { operation: 'rejected'; messageId: string; reason: string }
  | { operation: 'failed'; messageId: string; stage: string; errorCode: string }

export interface PlannerInput {
  /** The user's own words for this turn. */
  text: string
  /** The real persisted message id of this turn. */
  messageId: string
  /** Bounded history of the same conversation, oldest first. */
  recentUserMessages: readonly string[]
  /** Active facts for the predicates the turn mentions. */
  activeFacts: (predicate: FactPredicate) => readonly FactRecord[]
  /** The stored text of one memory, for species carry-over across corrections. */
  memoryTextOf?: ((memoryId: string) => string) | undefined
  /** False when the cognitive core is off or the ledger is unavailable. */
  ledgerAvailable: boolean
}

/** The explicit markers that authorize a local memory write. */
const SAVE_MARKER = /(?:请(?:你)?记住|帮我记住|帮我记(?:一下|着)|记住(?:我|这个|这件事|一下)|保存为记忆|把这(?:条|件事|个)记下来|please remember|remember that)/iu
const UPDATE_MARKER = /(?:更正|纠正|改一下|更新|改成|改为|说错了|说错|讲错了|记错了|不对|不是这个|i meant|i was wrong|correct that)/iu
/** A pronoun correction: 「它现在叫X」 — no predicate of its own. */
const PRONOUN_NAME = /它(?:现在)?(?:的?名字)?叫([^，。！？\n]{1,40})/u

/** Display text for a stored fact, keeping the species a pet fact names. */
export function displayTextFor(candidate: PlannedFact, sourceText: string, carriedSpecies?: '猫' | '狗' | null): string {
  if (candidate.predicate === 'pet_name') {
    const species = speciesOf(sourceText) ?? carriedSpecies ?? null
    if (species) return `我的${species}叫${candidate.value}。`
    return `我的宠物叫${candidate.value}。`
  }
  return candidate.displayText || DISPLAY_TEMPLATES[candidate.predicate]?.(candidate.value) || ''
}

export function speciesOf(text: string): '猫' | '狗' | null {
  if (/猫/u.test(text)) return '猫'
  if (/狗/u.test(text)) return '狗'
  return null
}

/** Display text per predicate; the memory the user sees must re-extract to
 * the same fact, so these mirror the extractor rules. */
const DISPLAY_TEMPLATES: Partial<Record<FactPredicate, (value: string) => string>> = {
  residence: (value) => '我住在' + value + '。',
  employer: (value) => '我在' + value + '工作。',
  name: (value) => '我的名字叫' + value + '。',
  age: (value) => '我' + value + '岁。',
  project_code: (value) => '我的项目代号是' + value + '。',
  health: (value) => '我对' + value + '过敏。',
  preference: (value) => '我喜欢' + value + '。',
  study: (value) => '我在学习' + value + '。',
  goal: (value) => '我的目标是' + value + '。',
  object_location: (value) => '我的证件放在' + value + '。'
}

function toPlannedFact(candidate: FactCandidate, sourceText: string): PlannedFact {
  const value = candidate.value
  const base = DISPLAY_TEMPLATES[candidate.predicate]?.(value) ?? `${candidate.predicate}: ${value}`
  const displayText = candidate.predicate === 'pet_name'
    ? displayTextFor({ predicate: 'pet_name', value, valueNormalized: candidate.valueNormalized, polarity: candidate.polarity, displayText: base }, sourceText)
    : base
  return {
    predicate: candidate.predicate,
    value,
    valueNormalized: candidate.valueNormalized,
    polarity: candidate.polarity,
    displayText
  }
}

/**
 * Plans the turn. Pure: the caller decides whether to execute (pre-response)
 * and records the outcome itself.
 */
export function planMemoryOperation(input: PlannerInput): MemoryOperationPlan {
  const text = input.text.trim()
  if (text.length === 0) return { operation: 'none', reason: 'empty_turn' }
  if (!input.ledgerAvailable) return { operation: 'failed', messageId: input.messageId, stage: 'planning', errorCode: 'LEDGER_UNAVAILABLE' }

  const save = SAVE_MARKER.test(text)
  const update = UPDATE_MARKER.test(text)
  if (!save && !update) return { operation: 'none', reason: 'no_explicit_marker' }

  // Facts the turn itself asserts (conservative extractor).
  const candidates = extractFactSlots(text).filter((candidate) => candidate.polarity === 'positive')

  if (candidates.length > 0) {
    // A correction needs an identifiable previous fact; a save with no
    // existing fact for the predicate is a plain create.
    const candidate = candidates[0]!
    const existing = input.activeFacts(candidate.predicate)
    const sameValue = existing.filter((fact) => fact.valueNormalized === candidate.valueNormalized)
    if (sameValue.length > 0) return { operation: 'none', reason: 'already_current' }

    // '我还有一只猫' introduces a SECOND animal: a new fact, not a correction.
    const another = /(?:还有|另一只|另外一个|另外一只|也有一只|also have another)/iu.test(text)
    if (existing.length === 0 || another) {
      return {
        operation: 'create',
        messageId: input.messageId,
        facts: candidates.map((item) => toPlannedFact(item, text)),
        confidence: 90,
        decisionReason: 'explicit_save_with_no_prior_fact'
      }
    }
    if (existing.length > 1) {
      return {
        operation: 'clarify',
        messageId: input.messageId,
        reason: 'multiple_active_values_for_predicate',
        candidates: existing.map((fact) => ({ value: fact.valueDisplay, memoryId: fact.sourceMemoryId }))
      }
    }
    const target = existing[0]!
    return {
      operation: 'correct',
      messageId: input.messageId,
      target: {
        memoryId: target.sourceMemoryId,
        factId: target.id,
        predicate: candidate.predicate,
        previousValue: target.valueDisplay,
        revision: target.sourceRevision
      },
      // Keep the species of the existing memory: correcting 咪咪→豆豆 stays
      // 「我的猫叫豆豆」 even when the correction sentence omits 猫.
      newValue: candidate.value,
      displayText: displayTextFor(toPlannedFact(candidate, text), text, speciesOf(input.memoryTextOf?.(target.sourceMemoryId) ?? '') ?? speciesOf(target.valueDisplay) ?? speciesOf(historyHint(input))),
      confidence: 85,
      decisionReason: 'explicit_correction_of_single_active_fact'
    }
  }

  // No claim of its own: a pronoun correction refers to an existing fact.
  if (update) {
    const pronoun = PRONOUN_NAME.exec(text)
    if (pronoun) {
      const value = pronoun[1]!.trim()
      const pets = input.activeFacts('pet_name')
      if (pets.length === 1) {
        const target = pets[0]!
        const species = speciesOf(text) ?? speciesOf(input.memoryTextOf?.(target.sourceMemoryId) ?? '') ?? speciesOf(historyHint(input)) ?? speciesOf(target.valueDisplay)
        const displayText = species ? `我的${species}叫${value}。` : `我的宠物叫${value}。`
        if (target.valueNormalized === value.toLocaleLowerCase()) return { operation: 'none', reason: 'already_current' }
        return {
          operation: 'correct',
          messageId: input.messageId,
          target: {
            memoryId: target.sourceMemoryId,
            factId: target.id,
            predicate: 'pet_name',
            previousValue: target.valueDisplay,
            revision: target.sourceRevision
          },
          newValue: value,
          displayText,
          confidence: 75,
          decisionReason: 'pronoun_correction_unique_referent'
        }
      }
      if (pets.length > 1) {
        return {
          operation: 'clarify',
          messageId: input.messageId,
          reason: 'pronoun_with_multiple_candidates',
          candidates: pets.map((fact) => ({ value: fact.valueDisplay, memoryId: fact.sourceMemoryId }))
        }
      }
      return { operation: 'clarify', messageId: input.messageId, reason: 'pronoun_without_referent', candidates: [] }
    }
    // An update request with nothing to update and nothing new to add.
    return { operation: 'none', reason: 'update_marker_without_target_or_value' }
  }

  return { operation: 'none', reason: 'save_marker_without_extractable_fact' }
}

/** Last user message before this turn — the only context the pronoun may use. */
function historyHint(input: PlannerInput): string {
  return input.recentUserMessages.at(-1) ?? ''
}

/** Rendered for the prompt: only what the executor verified. */
export interface MemoryOperationOutcome {
  operation: MemoryOperationKind
  /** committed_and_verified | rolled_back | recovery_required are the write outcomes. */
  status: 'committed_and_verified' | 'rolled_back' | 'recovery_required' | 'clarify' | 'rejected' | 'failed' | 'not_applied'
  predicate?: string
  previousValue?: string
  currentValue?: string
  memoryId?: string
  revision?: number
  factId?: string
  sourceMessageId?: string
  reason?: string
  errorCode?: string
  /** True when this turn's operation was already committed by an earlier call. */
  replayed?: boolean
}

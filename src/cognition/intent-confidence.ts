/**
 * B1 — multi-signal intent confidence.
 *
 *   z_i = w_s·s_i + w_e·e_i + w_m·m_i + w_k·k_i − w_a·a_i
 *
 * Five per-candidate features, all [0,1], all computed from evidence this process
 * already has:
 *
 *   s  semantic match   — the rule strength the decision layer assigned to the
 *                         candidate (same signal list, one scoring path)
 *   e  explicitness     — did a phrase-level marker decide it, or a weak lexical
 *                         hint? "我改主意了" is explicit; a bare "？" is not
 *   m  completeness     — does the turn supply what this reading needs (an
 *                         object for a query, an action+scope for a plan)?
 *   k  context fit      — agreement with confirmed context. **Not** "history
 *                         exists": a self-contained turn gets the same k with or
 *                         without history, so history alone can never lift a
 *                         score. Only a reference turn earns context credit, and
 *                         only when the prior turn actually shares content
 *   a  ambiguity        — unresolved reference, self-reported confusion,
 *                         deixis, negation, irony, competing candidates
 *
 * Candidate separation `d` is a **set-level** quantity: Δ = z₍₁₎ − z₍₂₎. It is
 * reported beside the scores and consumed by the decision rule, never folded into
 * a single candidate's feature vector.
 *
 * Status: **uncalibrated heuristic**. The weights come from a grid search over a
 * small labelled development set (`evals/stage-2/b1-devset.json`), which justifies
 * the direction of each weight, not the claim that the output is a probability.
 * The softmax `share` is a normalised score share, explicitly **not** a
 * probability: no independent calibration set exists.
 */
import { referenceDependenceOf, retrievalNeedOf, type IntentLabel } from './intent-decision'
import { readFactSlot } from '../memory/fact-slot'

/**
 * Non-negative, sums to 1. Origin: the grid search in `scripts/b1-calibrate.ts`
 * over `evals/stage-2/b1-devset.json` (26 cases, all features required non-zero,
 * ambiguity capped at 0.25, positive evidence ≥ 0.6, and — among equally accurate
 * vectors — the highest combined semantic+explicitness weight). It reaches 26/26
 * in-sample and 8/8 on the untouched holdout split; both are small numbers, so this
 * justifies the weights' direction, not their precision.
 */
export const INTENT_CONFIDENCE_WEIGHTS = {
  semantic: 0.1,
  explicitness: 0.6,
  completeness: 0.1,
  context: 0.1,
  ambiguity: 0.1
} as const

/** Band thresholds, chosen on the same development set as the weights. */
export const INTENT_CONFIDENCE_BANDS = {
  high: 0.62,
  medium: 0.45,
  /** Below this, a direction-changing reading cannot drive the answer alone. */
  clarify: 0.42
} as const

/** Δ below this means the top two readings are a coin flip. */
export const INTENT_MARGIN_FLOOR = 0.08
/** Temperature for the reported share. Not a probability model. */
export const INTENT_SHARE_TEMPERATURE = 0.12

export interface IntentCandidateInput {
  label: IntentLabel
  /** 0-100 rule strength from the decision layer. */
  score: number
  maxWeight: number
  reasons: readonly string[]
}

export interface IntentConfidenceInput {
  content: string
  priorUserBody: string | null
  candidates: readonly IntentCandidateInput[]
}

export interface IntentCandidateConfidence {
  label: IntentLabel
  /** z_i, rounded to 4 decimals. */
  z: number
  features: { semantic: number; explicitness: number; completeness: number; context: number; ambiguity: number }
  /** Normalised share over the candidate set. **Not** a calibrated probability. */
  share: number
}

export interface IntentAssessment {
  band: 'low' | 'medium' | 'high'
  top: IntentLabel
  topScore: number
  /** Δ = z₍₁₎ − z₍₂₎; equals topScore when there is a single candidate. */
  margin: number
  /**
   * True when the top two readings lead to *different* retrieval behaviour —
   * i.e. misreading the turn changes the direction of the answer. Only then is
   * asking worth the interruption.
   */
  directionChanging: boolean
  needsClarification: boolean
  /** Auditable feature codes; never free-form text. */
  reasons: string[]
  candidates: IntentCandidateConfidence[]
  calibration: 'uncalibrated_heuristic'
}

const CONTENT_MARKERS = /[\p{Script=Han}A-Za-z0-9]/gu
const NEGATION = /(?:不|没|别|未|非|无)|\b(?:not|no|never|without|don't|doesn't|isn't|aren't|won't)\b/iu
const IRONY = /(?:反讽|阴阳怪气|说反话|呵呵|真是好极了)|\b(?:sarcas\w*|sure,? that went well|great,? just great)\b/iu
const SELF_REPORTED_AMBIGUITY = /(?:你指的是什么|不确定你指|不太明白你的意思|我不懂你说的)|\b(?:i'?m not sure what you mean|unclear what you mean|ambiguous)\b/iu
const DEICTIC = /(?:这个|那个|它|他们|她们|这件事|那件事|上面(?:说的)?|刚才(?:说的)?|之前(?:说的|提的|提到的)|那么|那里|这点)|\b(?:it|this|those|these)\b/iu
const QUESTION_WORDS = /(?:什么|怎么|如何|为什么|哪(?:一?个|家|些|种|里|儿|年)?|什么时候|多少|谁|是否|吗)|\b(?:what|who|where|when|which|why|how)\b/iu
const ACTION_VERB = /(?:制定|计划|规划|安排|开始|准备|学习|练习|做|完成|实现|整理|写|读)|\b(?:plan|schedule|start|prepare|build|write|learn|practice|organize)\b/iu
const SCOPE_WORD = /(?:下周|下个月|本月|本周|今年|明天|每天|每周|预算|小时|天|周|月|年|目标|步骤|范围)|\b(?:next week|next month|this week|tomorrow|daily|weekly|budget|hours?|days?|weeks?|months?|goal|steps?|scope)\b/iu

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

/** Content characters only, so punctuation length cannot stand in for meaning. */
function contentLength(value: string): number {
  return (value.match(CONTENT_MARKERS) ?? []).length
}

function sharesContentTerm(current: string, prior: string): boolean {
  const bigrams = (value: string): Set<string> => {
    const set = new Set<string>()
    for (const run of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
      for (let index = 0; index + 1 < run.length; index += 1) set.add(run.slice(index, index + 2))
    }
    for (const word of value.match(/[a-z]{4,}/gu) ?? []) set.add(word)
    return set
  }
  const priorTerms = bigrams(prior)
  if (priorTerms.size === 0) return false
  for (const term of bigrams(current)) if (priorTerms.has(term)) return true
  return false
}

/**
 * e — how explicit the evidence is. A phrase-level marker (weight ≥ 80) states
 * the intent directly; a fact-predicate reading is one inference step removed;
 * anything else is a lexical hint.
 */
function explicitnessOf(candidate: IntentCandidateInput): number {
  const predicateOnly = candidate.reasons.every((reason) => reason.startsWith('fact_predicate'))
  if (candidate.maxWeight >= 80 && !predicateOnly) return 1
  if (candidate.reasons.some((reason) => reason.startsWith('fact_predicate'))) return 0.55
  if (candidate.maxWeight >= 62) return 0.6
  return 0.35
}

/**
 * m — does the turn supply what this reading needs? Deliberately coarse: it
 * separates "我想要…" from "帮我制定下周的计划，预算三千" without pretending to
 * parse syntax.
 */
function completenessOf(candidate: IntentCandidateInput, content: string): number {
  const length = contentLength(content)
  const hasQuestionWord = QUESTION_WORDS.test(content)
  const hasQuestionMark = /[?？]/u.test(content)
  switch (candidate.label) {
    case 'information_query': {
      if (hasQuestionWord && length >= 5) return 1
      if (hasQuestionMark && length >= 4) return 0.8
      return length >= 6 ? 0.6 : 0.35
    }
    case 'continuation':
      return hasQuestionWord || hasQuestionMark ? 0.9 : 0.5
    case 'goal_or_plan': {
      const action = ACTION_VERB.test(content)
      const scope = SCOPE_WORD.test(content)
      if (action && scope) return 1
      if (action) return 0.65
      return 0.4
    }
    case 'correction':
      // A correction needs the corrected value, not just "不对".
      return length >= 6 ? 1 : 0.45
    case 'preference_expression':
    case 'self_fact':
      return length >= 5 ? 0.9 : 0.5
    case 'emotion_expression':
    case 'feedback':
    case 'explanation':
    case 'exploration':
    case 'new_topic':
      return 0.85
    case 'ambiguous':
      return 0.3
    default:
      return 0.7
  }
}

/**
 * k — agreement with confirmed context, not the presence of context.
 *
 * A turn that does not reference the prior turn is consistent by default (1.0)
 * **whatever the history is** — that is what makes the three-history contrast
 * test pass. A reference turn earns credit only when the prior turn shares
 * content; unrelated history scores 0.2, missing history 0.
 */
function contextFitOf(candidate: IntentCandidateInput, input: IntentConfidenceInput): number {
  if (!referenceDependenceOf(candidate.label, candidate.reasons)) return 1
  if (!input.priorUserBody) return 0
  return sharesContentTerm(normalize(input.content), normalize(input.priorUserBody)) ? 1 : 0.2
}

/** a — sources of doubt, summed and clamped. */
function ambiguityOf(
  candidate: IntentCandidateInput,
  input: IntentConfidenceInput,
  contested: boolean
): { value: number; reasons: string[] } {
  const content = normalize(input.content)
  const reasons: string[] = []
  let value = 0
  const reference = referenceDependenceOf(candidate.label, candidate.reasons) || DEICTIC.test(content)
  if (reference && !input.priorUserBody) {
    value += 0.6
    reasons.push('reference_without_context')
  }
  if (SELF_REPORTED_AMBIGUITY.test(content)) {
    value += 0.8
    reasons.push('self_reported_ambiguity')
  }
  if (DEICTIC.test(content)) {
    value += 0.3
    reasons.push('deixis')
  }
  if (NEGATION.test(content)) {
    value += 0.15
    reasons.push('negation_present')
  }
  if (IRONY.test(content)) {
    value += 0.3
    reasons.push('irony_marker')
  }
  if (contested) {
    value += 0.2
    reasons.push('competing_readings')
  }
  return { value: clamp01(value), reasons }
}

/** Overrides used by the weight search; production callers pass nothing. */
export interface IntentConfidenceOverrides {
  weights?: typeof INTENT_CONFIDENCE_WEIGHTS
  marginFloor?: number
  clarifyThreshold?: number
}

export function assessIntentConfidence(input: IntentConfidenceInput, overrides: IntentConfidenceOverrides = {}): IntentAssessment {
  if (input.candidates.length === 0) {
    // No rule matched is not the same as "two readings compete". Nothing here can
    // change the direction of the answer, so asking would only interrupt: the
    // decision layer already labels this `ambiguous` with low strength, and that
    // label is answered rather than interrogated.
    return {
      band: 'low',
      top: 'ambiguous',
      topScore: 0,
      margin: 0,
      directionChanging: false,
      needsClarification: false,
      reasons: ['no_candidate'],
      candidates: [],
      calibration: 'uncalibrated_heuristic'
    }
  }
  const sorted = [...input.candidates].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
  const contested = sorted.length > 1 && sorted[0]!.score - sorted[1]!.score <= 10
  const w = overrides.weights ?? INTENT_CONFIDENCE_WEIGHTS
  const scored: IntentCandidateConfidence[] = sorted.map((candidate) => {
    const semantic = clamp01(candidate.score / 100)
    const explicitness = explicitnessOf(candidate)
    const completeness = completenessOf(candidate, normalize(input.content))
    const context = contextFitOf(candidate, input)
    const ambiguity = ambiguityOf(candidate, input, contested)
    const z = Number((
      w.semantic * semantic +
      w.explicitness * explicitness +
      w.completeness * completeness +
      w.context * context -
      w.ambiguity * ambiguity.value
    ).toFixed(4))
    return {
      label: candidate.label,
      z,
      features: { semantic, explicitness, completeness, context, ambiguity: ambiguity.value },
      share: 0
    }
  })

  // Order by z, not by rule strength: the whole point of the feature model is
  // that a weaker rule with better completeness and less ambiguity can win. The
  // first version sorted by rule score and then computed z, which produced
  // negative margins — a tell that the ranking and the score disagreed.
  scored.sort((left, right) => right.z - left.z || right.features.semantic - left.features.semantic || left.label.localeCompare(right.label))
  const top = scored[0]!
  const second = scored[1]
  const marginFloor = overrides.marginFloor ?? INTENT_MARGIN_FLOOR
  const margin = Number((top.z - (second?.z ?? 0)).toFixed(4))
  // Compare the *effective* retrieval need, not the static per-label table: a
  // general question and an explanation both answer without memory, even though
  // `information_query` is marked "retrieves" in the table. Using the table made
  // "How does photosynthesis work?" look like a direction-changing pair.
  const fact = readFactSlot(input.content)
  const reasonsOf = new Map(input.candidates.map((candidate) => [candidate.label, candidate.reasons]))
  const needsRetrieval = (label: IntentLabel): boolean => retrievalNeedOf(label, {
    content: input.content,
    fact,
    reasons: reasonsOf.get(label) ?? [],
    hasPriorTurn: Boolean(input.priorUserBody)
  })
  const directionChanging = second !== undefined && needsRetrieval(top.label) !== needsRetrieval(second.label)

  const exp = scored.map((candidate) => Math.exp(candidate.z / INTENT_SHARE_TEMPERATURE))
  const total = exp.reduce((sum, value) => sum + value, 0)
  scored.forEach((candidate, index) => { candidate.share = Number((exp[index]! / total).toFixed(4)) })

  const band: IntentAssessment['band'] = top.z >= INTENT_CONFIDENCE_BANDS.high && margin >= marginFloor
    ? 'high'
    : top.z >= INTENT_CONFIDENCE_BANDS.medium
      ? 'medium'
      : 'low'

  const topAmbiguity = top.features.ambiguity
  // Asking is only justified when the doubt is about *which answer to give*.
  // A vague turn with no competing reading is answered, not interrogated.
  const clarifyThreshold = overrides.clarifyThreshold ?? INTENT_CONFIDENCE_BANDS.clarify
  // An unresolved reference is a precondition, not a penalty. "那个怎么办？"
  // cannot be answered no matter how confidently its question shape scores: the
  // object is unknown, so any answer would be a guess. A 0.06 penalty against a
  // 0.6 completeness weight was swamped; as a gate it cannot be.
  const unresolvedReference = !input.priorUserBody && (
    input.candidates.some((candidate) => referenceDependenceOf(candidate.label, candidate.reasons)) ||
    DEICTIC.test(normalize(input.content))
  )
  const needsClarification =
    unresolvedReference ||
    (directionChanging && margin < marginFloor) ||
    (top.z < clarifyThreshold && directionChanging && topAmbiguity >= 0.5)

  const reasons: string[] = []
  if (contested) reasons.push('competing_readings')
  if (directionChanging) reasons.push('direction_changing_pair')
  if (margin < marginFloor) reasons.push('margin_below_floor')
  if (topAmbiguity >= 0.5) reasons.push('high_ambiguity')
  if (unresolvedReference) reasons.push('unresolved_reference')
  if (reasons.length === 0) reasons.push('decisive')
  if (needsClarification) reasons.push('clarify')

  return {
    band,
    top: top.label,
    topScore: top.z,
    margin,
    directionChanging,
    needsClarification,
    reasons,
    candidates: scored,
    calibration: 'uncalibrated_heuristic'
  }
}

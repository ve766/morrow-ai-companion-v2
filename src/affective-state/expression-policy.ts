/**
 * Expression policy (Stage 5, delivery B3).
 *
 * The internal state is a bounded, rule-derived estimate — not a feeling and
 * not evidence about the user. What it may change is *how* Morrow answers:
 * whether to clarify before asserting, whether to offer advice or first
 * acknowledge what the user said, how many optional questions are allowed, and
 * whether the reply should be brief. It never changes facts, permissions,
 * memory truth, or the personality baseline.
 *
 * The policy is a structured object rather than a pile of adjectives in the
 * prompt, so a test can compare the same input under two legal states and see
 * the strategy differ (and the facts not).
 */
import type { FeelingState } from './feeling'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'

export type AdviceMode = 'none' | 'acknowledge_first' | 'answer_directly'
export type ClarifyMode = 'as_needed' | 'prefer'

export interface ExpressionPolicy {
  /** Bounded strategy fields; every field has a closed set of values. */
  adviceMode: AdviceMode
  clarifyMode: ClarifyMode
  /** Optional follow-up questions allowed in this reply (0..2). */
  questionBudget: 0 | 1 | 2
  /** Prefer a shorter answer. */
  brevity: 'normal' | 'brief'
  /** Human-readable reason for the trace; never shown to the user. */
  rationale: string
}

export const EXPRESSION_POLICY_VERSION = 'expression-policy.v2'
/** Uncertainty above this prefers a clarifying question over a confident claim. */
export const CLARIFY_UNCERTAINTY_THRESHOLD = 0.55
/** D at or above this (with contextual corroboration) is distress. */
export const DISTRESS_THRESHOLD = 0.65
/** Contextual evidence below this cannot satisfy the combined rule alone. */
export const DISTRESS_CONTEXT_MIN = 0.40
/** E at or above this is an explicit, high-confidence emotion statement. */
export const DISTRESS_EXPLICIT_HIGH = 0.85

/**
 * Structured distress evidence (Issue #29 F3).
 *
 *   E — explicit emotion statement, from a full first-person/emotion frame
 *   C — contextual corroboration (a second, independent cue class)
 *   T — unresolved interaction tension from the bounded feeling state
 *   D = 0.55*E + 0.25*C + 0.20*T
 *
 * `distress = E >= 0.85 OR (D >= 0.65 AND C >= 0.40)`.
 *
 * A single character is never enough: "麻烦你帮我检查一下代码" contains 烦 but
 * has no emotion frame, so E=0 and no distress. The weights are a fixed,
 * explainable heuristic calibrated on the cases in
 * `docs/algorithms/stage-5-distress-evidence-calibration.md`; they are not a
 * probability and are never shown to the user.
 */
export interface DistressEvidence {
  explicit: number
  contextual: number
  tension: number
  score: number
  distress: boolean
  rationale: 'explicit_emotion_statement' | 'contextual_corroboration' | 'unresolved_tension_only' | 'no_distress_evidence'
}

/** A first-person emotion frame; 烦 is excluded when it starts 麻烦/烦请/烦琐/烦杂. */
const STRONG_EXPLICIT_PATTERNS: readonly RegExp[] = [
  /我(?:现在|今天|最近|这两天)?(?:(?:真的|特别|实在|非常|很|太|好|快|有点|有些|稍微)){0,2}(?:累|烦(?!麻|请|琐|杂)|难受|难过|崩溃|焦虑|害怕|委屈|生气|愤怒|绝望|撑不住|受不了|不想活)/u,
  /(?:今天|现在|最近|这两天)(?:(?:真的|特别|实在|非常|太|很|好)){1,2}(?:累|难受|难过|烦(?!麻|请|琐|杂)|崩溃|焦虑|害怕|委屈)/u,
  /(?:这事|这件事|这|那|他|她|你|工作|项目)(?:真|可|让|把)我(?:(?:真的|特别|实在|非常|很|太)){0,2}(?:累|烦(?!麻|请|琐|杂)|难受|难过|崩溃|焦虑|害怕|委屈|生气)/u,
  /我(?:真的|实在|快)?(?:撑不住|受不了|不想活)了/u
]

/** A weaker explicit statement needs corroboration before it can trigger. */
const MILD_EXPLICIT_PATTERN = /我(?:有点|有些|稍微)(?:累|烦(?!麻|请|琐|杂)|难受|难过|焦虑|害怕)/u

const SOMATIC_CUE = /(?:睡不着|失眠|没力气|不想动|吃不下|没胃口|心慌|喘不过气|头疼)/u
const INTENSITY_CUE = /(?:真的|特别|实在|非常|太|很|快|有点|有些)/u
const REPETITION_CUE = /(?:！|!|啊{2,}|呜{2,}|烦死|累死)/u

export function assessDistressEvidence(input: { text: string; tension: number }): DistressEvidence {
  const text = input.text.trim()
  const explicit = STRONG_EXPLICIT_PATTERNS.some((pattern) => pattern.test(text))
    ? 1
    : MILD_EXPLICIT_PATTERN.test(text)
      ? 0.6
      : 0
  // Contextual evidence is a second cue class, not a second copy of the same
  // word: an explicit frame, a somatic cue, and emphatic punctuation are three
  // independent classes; one class alone earns 0.4, two or more earn 0.8.
  const cueClasses = [
    explicit > 0,
    SOMATIC_CUE.test(text),
    REPETITION_CUE.test(text),
    INTENSITY_CUE.test(text) && explicit > 0
  ].filter(Boolean).length
  const contextual = cueClasses >= 2 ? 0.8 : cueClasses === 1 && explicit > 0 ? 0.4 : 0
  const tension = Math.max(0, Math.min(1, input.tension))
  const score = 0.55 * explicit + 0.25 * contextual + 0.2 * tension
  const distress = explicit >= DISTRESS_EXPLICIT_HIGH || (score >= DISTRESS_THRESHOLD && contextual >= DISTRESS_CONTEXT_MIN)
  return {
    explicit,
    contextual,
    tension,
    score,
    distress,
    rationale: explicit >= DISTRESS_EXPLICIT_HIGH
      ? 'explicit_emotion_statement'
      : distress
        ? 'contextual_corroboration'
        : tension > 0
          ? 'unresolved_tension_only'
          : 'no_distress_evidence'
  }
}

export function deriveExpressionPolicy(input: {
  state: FeelingState | null
  analysis: CognitiveTurnAnalysis | null
  /** True when the user explicitly asked for a direct answer or a fix. */
  wantsDirectAnswer: boolean
  /** The user's own words, for explicit distress evidence only. */
  text?: string | undefined
}): ExpressionPolicy {
  const state = input.state
  const analysis = input.analysis
  const tension = state?.values.tension ?? 0
  const uncertainty = analysis?.uncertainty === 'high' ? 0.8 : analysis?.uncertainty === 'medium' ? 0.55 : 0.25
  const evidence = assessDistressEvidence({ text: input.text ?? '', tension })

  // A direct request wins over warmth: the user asked for the answer, not for
  // company. This ordering is the point of the policy.
  if (input.wantsDirectAnswer) {
    return {
      adviceMode: 'answer_directly',
      clarifyMode: 'as_needed',
      questionBudget: 1,
      brevity: 'brief',
      rationale: 'explicit_direct_request'
    }
  }
  if (uncertainty >= CLARIFY_UNCERTAINTY_THRESHOLD) {
    return {
      adviceMode: evidence.distress ? 'acknowledge_first' : 'none',
      clarifyMode: 'prefer',
      questionBudget: 2,
      brevity: 'normal',
      // Kept from the v1 trace vocabulary: downstream scenarios and dashboards
      // already read these labels. The calibrated reason is on the evidence
      // object, not in the user-visible prompt.
      rationale: evidence.distress ? 'uncertain_and_user_tension' : 'uncertain_reading'
    }
  }
  if (evidence.distress) {
    return {
      adviceMode: 'acknowledge_first',
      clarifyMode: 'as_needed',
      questionBudget: 1,
      brevity: 'normal',
      rationale: 'user_tension_unresolved'
    }
  }
  return {
    adviceMode: 'none',
    clarifyMode: 'as_needed',
    questionBudget: 2,
    brevity: 'normal',
    rationale: evidence.rationale === 'unresolved_tension_only' ? 'unresolved_tension_only' : 'no_special_condition'
  }
}

/**
 * One compact block. It states the strategy, not the numbers, and repeats the
 * invariant that facts are untouched.
 */
export function describeExpressionPolicy(policy: ExpressionPolicy): string {
  const parts: string[] = ['Expression strategy for this reply (derived from the bounded interaction state; it changes how you answer, never what is true):']
  if (policy.adviceMode === 'answer_directly') parts.push('- The user asked for the answer: answer it directly and briefly; do not open with empathy or extra questions.')
  if (policy.adviceMode === 'acknowledge_first') parts.push('- Acknowledge what the user just said in one sentence before any advice; do not lead with a list.')
  if (policy.clarifyMode === 'prefer') parts.push('- Your reading of this turn is uncertain: prefer one clarifying question over a confident claim.')
  parts.push(`- Optional follow-up questions allowed: ${policy.questionBudget}. Do not expose internal state, confidence numbers, revision ids or memory ids to the user.`)
  return parts.join('\n')
}

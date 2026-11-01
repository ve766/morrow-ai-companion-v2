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

export const EXPRESSION_POLICY_VERSION = 'expression-policy.v1'
/** Uncertainty above this prefers a clarifying question over a confident claim. */
export const CLARIFY_UNCERTAINTY_THRESHOLD = 0.55
/** Unresolved tension above this asks Morrow to acknowledge before advising. */
export const ACKNOWLEDGE_TENSION_THRESHOLD = 0.05

export function deriveExpressionPolicy(input: {
  state: FeelingState | null
  analysis: CognitiveTurnAnalysis | null
  /** True when the user explicitly asked for a direct answer or a fix. */
  wantsDirectAnswer: boolean
}): ExpressionPolicy {
  const state = input.state
  const analysis = input.analysis
  const tension = state?.values.tension ?? 0
  const uncertainty = analysis?.uncertainty === 'high' ? 0.8 : analysis?.uncertainty === 'medium' ? 0.55 : 0.25
  const userDistress = analysis?.signals.negation === true || tension >= ACKNOWLEDGE_TENSION_THRESHOLD

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
      adviceMode: userDistress ? 'acknowledge_first' : 'none',
      clarifyMode: 'prefer',
      questionBudget: 2,
      brevity: 'normal',
      rationale: userDistress ? 'uncertain_and_user_tension' : 'uncertain_reading'
    }
  }
  if (userDistress) {
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
    rationale: 'no_special_condition'
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

/**
 * Internal state -> retrieval decision, Phase 2.4 (§5.4).
 *
 * Until now the interaction state only reached the prompt as wording. That is
 * a real effect, but it is not a *decision*: nothing downstream changed, so a
 * bug in the state would have been invisible. This module gives the state one
 * bounded, deterministic consequence that can be observed in the serialized
 * request: how many related entries may be delivered.
 *
 * The direction is deliberately asymmetric. The state may widen retrieval
 * (raised exploration priority after the user explicitly invited exploring),
 * and it can never narrow it below the intent's cap, never change the
 * predicate filter, never change the sensitivity ceiling, and never admit a
 * retracted record. Retrieval policy is a cap; the assembler still decides
 * relevance and the security layer still decides permission.
 */
import type { FeelingState } from '../affective-state/feeling'
import type { RetrievalPolicy } from '../memory/retrieval-policy'

/**
 * Priority above which the state is treated as an active exploration signal.
 *
 * One explicit exploration request raises the priority by roughly 0.04 at the
 * confidence the rule engine reports, so this threshold is reached after about
 * two of them inside the 36-hour half-life — the point where "the user asked to
 * explore recently" is still true. A threshold of 0.3 would never be reached by
 * this engine and would make the coupling dead code.
 */
export const EXPLORATION_WIDEN_THRESHOLD = 0.08
/** Bounded increase: at most two extra entries, whatever the priority. */
export const EXPLORATION_WIDEN_ENTRIES = 2
/** Absolute ceiling for the widened cap, independent of the intent. */
export const WIDENED_MAX_CEILING = 25

export interface RetrievalAdjustment {
  policy: RetrievalPolicy
  /** The cap the intent allowed before any adjustment. */
  baseMax: number
  /** The cap actually applied. */
  effectiveMax: number
  /** A short rule code, or null when the intent's cap was used unchanged. */
  adjustment: string | null
}

/**
 * Applies the state's bounded influence to an intent policy.
 *
 * A policy that already allows nothing (`maxMemories === 0`, e.g. feedback)
 * stays at nothing: the state can never be a reason to recall personal facts
 * in a turn that should not recall any.
 */
export function adjustPolicyForState(policy: RetrievalPolicy, state: FeelingState | null | undefined): RetrievalAdjustment {
  const baseMax = policy.maxMemories
  if (!state || baseMax <= 0) return { policy, baseMax, effectiveMax: baseMax, adjustment: null }
  const priority = state.attention.explorationPriority
  if (!Number.isFinite(priority) || priority < EXPLORATION_WIDEN_THRESHOLD) {
    return { policy, baseMax, effectiveMax: baseMax, adjustment: null }
  }
  const effectiveMax = Math.min(baseMax + EXPLORATION_WIDEN_ENTRIES, WIDENED_MAX_CEILING)
  if (effectiveMax <= baseMax) return { policy, baseMax, effectiveMax: baseMax, adjustment: null }
  return {
    policy: { ...policy, maxMemories: effectiveMax, reason: `${policy.reason}; widened by exploration attention` },
    baseMax,
    effectiveMax,
    adjustment: 'exploration_widened'
  }
}

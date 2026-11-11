/**
 * Context block utility (Stage 2, algorithm B3).
 *
 *   U(c) = wr·R + wf·F + wq·Q + wp·P − wx·X − wd·D
 *
 *   R relevance to the current turn, F freshness, Q evidence quality
 *   (confidence × source reliability), P preference/personality fit,
 *   X conflict risk, D stale/forbidden penalty.
 *
 * Two rules keep this honest:
 *
 *   1. **Hard exclusions are not a score.** Retracted, deleted, superseded and
 *      unauthorized blocks never reach this function. A negative weight can be
 *      outweighed by a high relevance term, so "penalise it heavily" is not a
 *      privacy control — exclusion is.
 *   2. **Every component is normalized to [0, 1] before weighting**, so the
 *      weights below are comparable and the result stays in a known range
 *      (−(wx+wd) … wr+wf+wq+wp) instead of drifting with raw character counts.
 */
export const CONTEXT_UTILITY_WEIGHTS = {
  relevance: 0.4,
  freshness: 0.25,
  quality: 0.2,
  preference: 0.1,
  conflict: 0.15,
  stale: 0.05
} as const

export interface ContextUtilityInput {
  /** R — query relevance, [0, 1]. */
  relevance: number
  /** F — freshness, [0, 1]; 1 means just confirmed. */
  freshness: number
  /** Q — confidence × source reliability, [0, 1]. */
  quality: number
  /** P — preference/personality fit, [0, 1]. */
  preference: number
  /** X — conflict risk, [0, 1]. */
  conflict: number
  /** D — staleness / degraded suitability, [0, 1]. */
  stale: number
}

export interface ContextUtilityBreakdown {
  score: number
  components: Required<ContextUtilityInput>
  reason: string
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function contextUtility(input: ContextUtilityInput): ContextUtilityBreakdown {
  const components = {
    relevance: clamp01(input.relevance),
    freshness: clamp01(input.freshness),
    quality: clamp01(input.quality),
    preference: clamp01(input.preference),
    conflict: clamp01(input.conflict),
    stale: clamp01(input.stale)
  }
  const w = CONTEXT_UTILITY_WEIGHTS
  const raw =
    w.relevance * components.relevance +
    w.freshness * components.freshness +
    w.quality * components.quality +
    w.preference * components.preference -
    w.conflict * components.conflict -
    w.stale * components.stale
  const score = Number(raw.toFixed(6))
  return { score, components, reason: describe(components, score) }
}

function describe(components: Required<ContextUtilityInput>, score: number): string {
  const parts: string[] = []
  if (components.relevance > 0) parts.push('relevant')
  if (components.quality >= 0.8) parts.push('high_quality')
  if (components.freshness >= 0.8) parts.push('fresh')
  if (components.conflict > 0) parts.push('conflict')
  if (components.stale > 0) parts.push('stale')
  if (parts.length === 0) parts.push('low_signal')
  return `${parts.join('+')}:${score.toFixed(3)}`
}

/** Freshness half-life for confirmed memories, in days. */
export const FRESHNESS_HALF_LIFE_DAYS = 30

export function freshnessOf(referenceIso: string, nowIso: string): number {
  const ageDays = Math.max(0, (Date.parse(nowIso) - Date.parse(referenceIso)) / 86_400_000)
  if (!Number.isFinite(ageDays)) return 0
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS)
}

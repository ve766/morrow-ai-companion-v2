/**
 * Multi-signal intent confidence (Stage 2, algorithm B1).
 *
 *   s_i = α·r_i + β·c_i + γ·e_i + δ·h_i
 *
 *   r rule evidence, c current-turn context fit, e memory evidence,
 *   h history continuity. Every signal is normalized to [0, 1] before
 *   weighting, so the weights are comparable and `s` stays in [0, 1].
 *
 * This number is **not a probability**. It is an uncalibrated weighted sum of
 * rule-derived evidence; `calibration` says so and the prompt block repeats it.
 * Calibration would need labelled data and a fitted model, neither of which
 * exists in this repository.
 *
 * Missing signals are handled by renormalizing over what is available rather
 * than substituting a default: a missing memory-evidence signal must not look
 * like "no evidence" (0) and it must not look like "strong evidence" (1).
 */
export const INTENT_CONFIDENCE_WEIGHTS = {
  rule: 0.45,
  context: 0.25,
  evidence: 0.15,
  history: 0.15
} as const

/** Below this, the reading is too weak to act on without asking. */
export const CLARIFY_THRESHOLD = 0.45
/** Below this gap between the top two candidates, the choice is a coin flip. */
export const CLARIFY_MARGIN = 0.1

export interface IntentSignals {
  /** r — deterministic rule match strength, [0,1] or null when not computed. */
  rule: number | null
  /** c — fit with the current turn's context, [0,1] or null. */
  context: number | null
  /** e — support from retrieved memory evidence, [0,1] or null. */
  evidence: number | null
  /** h — continuity with earlier turns, [0,1] or null. */
  history: number | null
}

export interface IntentAssessment {
  confidence: number
  needsClarification: boolean
  /** Which signals actually contributed, and which were absent. */
  used: string[]
  missing: string[]
  calibration: 'uncalibrated_rule_evidence'
}

function clamp01(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

export function assessIntentConfidence(signals: IntentSignals, alternatives = 0): IntentAssessment {
  const w = INTENT_CONFIDENCE_WEIGHTS
  const entries: Array<[keyof IntentSignals, number, number | null]> = [
    ['rule', w.rule, clamp01(signals.rule)],
    ['context', w.context, clamp01(signals.context)],
    ['evidence', w.evidence, clamp01(signals.evidence)],
    ['history', w.history, clamp01(signals.history)]
  ]
  const used = entries.filter(([, , value]) => value !== null)
  const missing = entries.filter(([, , value]) => value === null).map(([name]) => name)
  const totalWeight = used.reduce((sum, [, weight]) => sum + weight, 0)
  if (totalWeight === 0) {
    // Nothing was measured. Reporting 0 would read as "certainly wrong", so the
    // honest answer is "unknown", and unknown always asks.
    return { confidence: 0, needsClarification: true, used: [], missing, calibration: 'uncalibrated_rule_evidence' }
  }
  const weighted = used.reduce((sum, [, weight, value]) => sum + weight * (value as number), 0)
  const confidence = Number((weighted / totalWeight).toFixed(4))
  const ambiguousChoice = alternatives > 0 && confidence < CLARIFY_THRESHOLD + CLARIFY_MARGIN
  return {
    confidence,
    needsClarification: confidence < CLARIFY_THRESHOLD || ambiguousChoice,
    used: used.map(([name]) => name),
    missing,
    calibration: 'uncalibrated_rule_evidence'
  }
}

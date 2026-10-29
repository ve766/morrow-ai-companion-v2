import { describe, expect, it } from 'vitest'
import { assessIntentConfidence, CLARIFY_THRESHOLD, INTENT_CONFIDENCE_WEIGHTS } from './intent-confidence'

describe('multi-signal intent confidence', () => {
  it('is a weighted average of the available signals, not a probability claim', () => {
    const all = assessIntentConfidence({ rule: 1, context: 1, evidence: 1, history: 1 })
    expect(all.confidence).toBeCloseTo(1, 6)
    expect(all.calibration).toBe('uncalibrated_rule_evidence')

    const half = assessIntentConfidence({ rule: 0.5, context: 0.5, evidence: 0.5, history: 0.5 })
    expect(half.confidence).toBeCloseTo(0.5, 6)
    expect(INTENT_CONFIDENCE_WEIGHTS.rule + INTENT_CONFIDENCE_WEIGHTS.context + INTENT_CONFIDENCE_WEIGHTS.evidence + INTENT_CONFIDENCE_WEIGHTS.history).toBeCloseTo(1, 6)
  })

  it('renormalizes over available signals instead of treating a missing one as zero', () => {
    const withEvidence = assessIntentConfidence({ rule: 0.9, context: 0.9, evidence: 0.9, history: 0.9 })
    const withoutEvidence = assessIntentConfidence({ rule: 0.9, context: 0.9, evidence: null, history: 0.9 })
    // Dropping a signal that agrees with the others must not drag the score down.
    expect(withoutEvidence.confidence).toBeCloseTo(withEvidence.confidence, 4)
    expect(withoutEvidence.missing).toContain('evidence')
  })

  it('asks for clarification when nothing was measured', () => {
    const empty = assessIntentConfidence({ rule: null, context: null, evidence: null, history: null })
    expect(empty.confidence).toBe(0)
    expect(empty.needsClarification).toBe(true)
    expect(empty.used).toEqual([])
  })

  it('asks when the score is weak, and when two candidates are too close', () => {
    expect(assessIntentConfidence({ rule: 0.2, context: 0.2, evidence: null, history: null }).needsClarification).toBe(true)
    expect(assessIntentConfidence({ rule: 0.3, context: 0.3, evidence: null, history: null }, 1).needsClarification).toBe(true)
    // A confident, unambiguous reading does not ask.
    expect(assessIntentConfidence({ rule: 0.9, context: 0.9, evidence: 0.9, history: 0.9 }, 1).needsClarification).toBe(false)
    expect(CLARIFY_THRESHOLD).toBeGreaterThan(0)
  })

  it('clamps out-of-range and non-finite signals', () => {
    const clamped = assessIntentConfidence({ rule: 5, context: -2, evidence: Number.NaN, history: null })
    // rule clamps to 1, context to 0; the two nulls drop out of the average.
    expect(clamped.confidence).toBeCloseTo(0.45 / 0.7, 4)
    expect(clamped.missing).toContain('history')
    expect(clamped.missing).toContain('evidence')
  })
})

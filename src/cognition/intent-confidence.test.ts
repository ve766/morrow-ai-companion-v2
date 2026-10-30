/**
 * B1 — the multi-signal confidence model.
 *
 * These tests pin the properties the model exists for, not exact numbers:
 * history must not lift a reading that stands on its own, context credit must be
 * earned by shared content, doubt must lower the score, and clarification is
 * reserved for turns where the leading readings would retrieve differently.
 */
import { describe, expect, it } from 'vitest'
import {
  assessIntentConfidence,
  INTENT_CONFIDENCE_BANDS,
  INTENT_CONFIDENCE_WEIGHTS,
  INTENT_MARGIN_FLOOR
} from './intent-confidence'
import type { IntentCandidateInput, IntentConfidenceInput } from './intent-confidence'

function candidate(label: IntentCandidateInput['label'], score: number, reasons: string[] = ['question_marker']): IntentCandidateInput {
  return { label, score, maxWeight: score, reasons }
}

function input(content: string, candidates: IntentCandidateInput[], priorUserBody: string | null = null): IntentConfidenceInput {
  return { content, priorUserBody, candidates }
}

describe('B1 feature model', () => {
  it('keeps every feature weighted and the weights normalised', () => {
    const values = Object.values(INTENT_CONFIDENCE_WEIGHTS)
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6)
    // A zeroed feature is a broken scorer, not a tuned one.
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.05)
    expect(INTENT_MARGIN_FLOOR).toBeGreaterThan(0)
    expect(INTENT_CONFIDENCE_BANDS.high).toBeGreaterThan(INTENT_CONFIDENCE_BANDS.medium)
    expect(INTENT_CONFIDENCE_BANDS.medium).toBeGreaterThanOrEqual(INTENT_CONFIDENCE_BANDS.clarify)
  })

  it('scores a standalone reading identically with no history, unrelated history and related history', () => {
    // The property the old model violated: "我住在哪里？" scored 0.78 on a first
    // turn and 0.947 with any history, purely because history existed.
    const candidates = [candidate('information_query', 80)]
    const without = assessIntentConfidence(input('我住在哪里？', candidates, null))
    const unrelated = assessIntentConfidence(input('我住在哪里？', candidates, '帮我看看这道数学题。'))
    const related = assessIntentConfidence(input('我住在哪里？', candidates, '我最近在找杭州的房子。'))
    expect(unrelated.topScore).toBe(without.topScore)
    expect(related.topScore).toBe(without.topScore)
    expect(related.candidates[0]!.features.context).toBe(1)
    expect(without.candidates[0]!.features.context).toBe(1)
  })

  it('gives a reference reading context credit only when the prior turn shares content', () => {
    const candidates = [candidate('continuation', 86, ['reference_to_prior_turn'])]
    const unresolved = assessIntentConfidence(input('那后天呢？', candidates, null))
    const unrelated = assessIntentConfidence(input('那后天呢？', candidates, '我最近在找杭州的房子。'))
    const related = assessIntentConfidence(input('那后天呢？', candidates, '明天后天都会下雨吗？'))
    expect(unrelated.candidates[0]!.features.context).toBe(0.2)
    expect(related.candidates[0]!.features.context).toBe(1)
    expect(related.topScore).toBeGreaterThan(unrelated.topScore)
    // Without a prior turn the reading is not merely weaker: the feature is 0.
    expect(unresolved.candidates[0]!.features.context).toBe(0)
  })

  it('lowers the score when the turn carries doubt', () => {
    const plain = assessIntentConfidence(input('我住在哪里？', [candidate('information_query', 80)]))
    const negative = assessIntentConfidence(input('我不是住在哪里？', [candidate('information_query', 80)]))
    const ironic = assessIntentConfidence(input('你说得真好，呵呵。', [candidate('feedback', 88, ['feedback_marker'])]))
    expect(negative.candidates[0]!.features.ambiguity).toBeGreaterThan(plain.candidates[0]!.features.ambiguity)
    expect(negative.topScore).toBeLessThan(plain.topScore)
    expect(ironic.candidates[0]!.features.ambiguity).toBeGreaterThan(0)
  })

  it('ranks by the full model, not by raw rule strength', () => {
    // Both readings are explicit markers, so the tie is broken by the remaining
    // features (completeness of the plan request vs. the explanation reading).
    const assessment = assessIntentConfidence(input('帮我制定下周的学习计划，预算三千。', [
      candidate('explanation', 82, ['explanation_marker']),
      candidate('goal_or_plan', 88, ['goal_or_plan_marker'])
    ]))
    expect(assessment.top).toBe('goal_or_plan')
    expect(assessment.margin).toBeGreaterThan(0)

    // A weak lexical hint does not beat an explicit marker just by looking long.
    const weak = assessIntentConfidence(input('帮我制定下周的学习计划，预算三千。', [
      candidate('information_query', 64, ['question_punctuation']),
      candidate('goal_or_plan', 88, ['goal_or_plan_marker'])
    ]))
    expect(weak.top).toBe('goal_or_plan')
    expect(weak.candidates.find((item) => item.label === 'information_query')!.features.explicitness)
      .toBeLessThan(weak.candidates.find((item) => item.label === 'goal_or_plan')!.features.explicitness)
  })

  it('reports a share that sums to one, and never calls it a probability', () => {
    const assessment = assessIntentConfidence(input('那后天呢？', [
      candidate('continuation', 86, ['reference_to_prior_turn']),
      candidate('information_query', 80)
    ], '明天天气怎么样？'))
    const total = assessment.candidates.reduce((sum, item) => sum + item.share, 0)
    expect(total).toBeCloseTo(1, 2)
    expect(assessment.calibration).toBe('uncalibrated_heuristic')
  })
})

describe('B1 decision rule', () => {
  it('does not ask when nothing was measured — no reading means no direction to doubt', () => {
    const empty = assessIntentConfidence(input('嗯。', []))
    expect(empty.needsClarification).toBe(false)
    expect(empty.reasons).toContain('no_candidate')
    expect(empty.band).toBe('low')
  })

  it('asks when two readings would retrieve differently and the margin is thin', () => {
    // continuation retrieves, ambiguous does not — misreading changes the route.
    // The margin floor is raised to exercise the branch deterministically: this
    // tests the rule, not a claim that such a turn occurs.
    const assessment = assessIntentConfidence(input('那个怎么办？', [
      candidate('continuation', 86, ['reference_to_prior_turn']),
      candidate('ambiguous', 84, ['self_reported_ambiguity'])
    ], '我的租房合同下周到期。'), { marginFloor: 0.6 })
    expect(assessment.directionChanging).toBe(true)
    expect(assessment.needsClarification).toBe(true)
    expect(assessment.reasons).toContain('clarify')
  })

  it('asks whenever a reference cannot be resolved, however confidently the rest scores', () => {
    const assessment = assessIntentConfidence(input('那个怎么办？', [candidate('information_query', 90)]))
    expect(assessment.needsClarification).toBe(true)
    expect(assessment.reasons).toContain('unresolved_reference')
  })

  it('does not ask when both readings would answer the same way', () => {
    // Misreading changes the label but not the route, so asking buys nothing.
    const assessment = assessIntentConfidence(input('我下周有哪些安排？', [
      candidate('information_query', 84, ['explicit_recall_request']),
      candidate('goal_or_plan', 82, ['goal_or_plan_marker'])
    ]))
    expect(assessment.directionChanging).toBe(false)
    expect(assessment.needsClarification).toBe(false)
  })

  it('does not ask for a clear, complete request', () => {
    const assessment = assessIntentConfidence(input('帮我制定下周的学习计划，预算三千。', [
      candidate('goal_or_plan', 88, ['goal_or_plan_marker'])
    ]))
    expect(assessment.needsClarification).toBe(false)
    expect(assessment.band).toBe('high')
  })
})

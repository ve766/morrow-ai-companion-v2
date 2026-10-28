import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runIntentDecisionEvaluation } from './intent-decision-evaluation'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'evaluation/fixtures/intent-decision-v1.json'), 'utf8')) as unknown

describe('phase 2 F: deterministic intent-decision evaluation', () => {
  it('classifies every fixed case and passes its gate', () => {
    const report = runIntentDecisionEvaluation(fixture)
    expect(report.dataset).toMatchObject({ id: 'intent-decision-synthetic-v1', version: '1.0.0', caseCount: 25 })
    expect(report.metrics.intentAccuracy).toBe(1)
    expect(report.metrics.routingAccuracy).toBe(1)
    expect(report.metrics.missingReasons).toBe(0)
    expect(report.determinism.passed).toBe(true)
    expect(report.gate).toEqual({ passed: true, failedChecks: [] })
    // Every required Phase-2 class is represented, not just the easy ones.
    for (const label of ['information_query', 'continuation', 'correction', 'preference_expression', 'emotion_expression', 'goal_or_plan', 'new_topic', 'ambiguous']) {
      expect(report.metrics.perClass[label]?.total, label).toBeGreaterThan(0)
    }
  })

  it('rejects a malformed dataset instead of reporting a pass', () => {
    expect(() => runIntentDecisionEvaluation(null)).toThrow()
    expect(() => runIntentDecisionEvaluation({ schemaVersion: 1, source: 'synthetic', datasetId: 'x', datasetVersion: '1.0.0', cases: [] })).toThrow()
    expect(() => runIntentDecisionEvaluation({
      schemaVersion: 1, source: 'synthetic', datasetId: 'x', datasetVersion: '1.0.0',
      cases: [{ id: 'a', input: 'b', hasPriorTurn: false, expected: { intent: 'not_a_label', needsMemoryRetrieval: false, dependsOnPriorTurn: false, mayProduceMemoryCandidate: false } }]
    })).toThrow()
  })
})

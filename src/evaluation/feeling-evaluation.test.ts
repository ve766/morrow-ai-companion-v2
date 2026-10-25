import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FeelingEvaluationError, runFeelingEvaluation } from './feeling-evaluation'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'evaluation/fixtures/feeling-v1.json'), 'utf8')) as unknown

describe('offline computational-feeling evaluation', () => {
  it('compares local event/state rules against no-update baseline on fixed synthetic cases', () => {
    const report = runFeelingEvaluation(fixture)
    expect(report.dataset).toMatchObject({ source: 'synthetic', caseCount: 34, schemaVersion: 1 })
    expect(report.comparison.baseline.eventClassificationAccuracy).toBeLessThan(report.comparison.candidate.eventClassificationAccuracy)
    expect(report.comparison.baseline).toMatchObject({
      predictedEventCount: 0,
      eventPrecision: null,
      eventPrecisionDefined: false,
      eventRecall: 0
    })
    expect(report.metrics).toMatchObject({
      eventDetectionPrecision: 1,
      eventDetectionRecall: 1,
      eventFalsePositiveCount: 0,
      eventFalseNegativeCount: 0,
      eventWrongTypeCount: 0,
      intentAccuracy: 1,
      eventClassificationAccuracy: 1,
      stateDirectionAccuracy: 1,
      attentionDirectionAccuracy: 1,
      userAffectTransferCount: 0,
      boundViolations: 0,
      attentionBoundViolations: 0,
      evidenceTraceabilityFailures: 0,
      behaviorGuidanceFailures: 0,
      providerCalls: 0,
      remoteCalls: 0,
      toolCalls: 0
    })
    expect(report.parameterSensitivity.testedCombinations).toBe(18)
    expect(report.parameterSensitivity.attentionPriorityRangeAfterSixHours.at(1)!).toBeGreaterThan(
      report.parameterSensitivity.attentionPriorityRangeAfterSixHours.at(0)!
    )
    expect(report.determinism.passed).toBe(true)
    expect(report.determinism.resultHash).toBe(report.determinism.repeatedResultHash)
    expect(report.gate).toEqual({ passed: true, failedChecks: [] })
  })

  it('rejects malformed or non-synthetic cases rather than silently dropping rows', () => {
    const nonSynthetic = structuredClone(fixture) as { source: string }
    nonSynthetic.source = 'production'
    expect(() => runFeelingEvaluation(nonSynthetic)).toThrowError(expect.objectContaining({ code: 'INVALID_DATASET' }))

    const unknownEvent = structuredClone(fixture) as { cases: Array<{ expected: { eventType: string | null } }> }
    unknownEvent.cases[0]!.expected.eventType = 'unvalidated-emotion'
    expect(() => runFeelingEvaluation(unknownEvent)).toThrowError(expect.objectContaining({ code: 'INVALID_EXPECTATION' }))
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCognitiveEvaluation } from './cognitive-evaluation'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'evaluation/fixtures/cognitive-turn-v1.json'), 'utf8')) as unknown

describe('offline cognitive-turn evaluation', () => {
  it('compares the fixed synthetic corpus with a simple baseline and repeats deterministically', () => {
    const report = runCognitiveEvaluation(fixture)
    expect(report.dataset).toMatchObject({ source: 'synthetic', caseCount: 26, schemaVersion: 1, version: '1.1.0' })
    expect(report.comparison.baseline).toMatchObject({
      intentAccuracy: 0.3462,
      strategyAccuracy: 0.8077,
      topicReferenceAccuracy: 0.9231,
      correctionPrecision: null,
      correctionRecall: 0,
      goalPrecision: null,
      goalRecall: 0
    })
    expect(report.comparison.candidate).toMatchObject({
      intentAccuracy: 1,
      strategyAccuracy: 1,
      topicReferenceAccuracy: 1,
      correctionPrecision: 1,
      correctionRecall: 1,
      goalPrecision: 1,
      goalRecall: 1
    })
    expect(report.cases.filter((item) => item.expected.strategy === 'clarify')).toHaveLength(2)
    expect(report.metrics).toMatchObject({
      intentAccuracy: 1,
      strategyAccuracy: 1,
      topicReferenceAccuracy: 1,
      correctionPrecision: 1,
      correctionRecall: 1,
      safeObservationViolations: 0
    })
    expect(report.safety).toEqual({ automaticMemoryWrites: 0, automaticPersonalityWrites: 0, remoteCalls: 0, toolCalls: 0 })
    expect(report.checks).toMatchObject({
      improvesIntentOverBaseline: true,
      improvesStrategyOverBaseline: true,
      improvesTopicReferenceOverBaseline: true,
      improvesCorrectionRecallOverBaseline: true,
      improvesGoalRecallOverBaseline: true
    })
    expect(report.determinism.passed).toBe(true)
    expect(report.determinism.resultHash).toBe(report.determinism.repeatedResultHash)
    expect(report.gate).toEqual({ passed: true, failedChecks: [] })
  })

  it('rejects non-synthetic or malformed evaluation inputs', () => {
    const nonSynthetic = structuredClone(fixture) as { source: string }
    nonSynthetic.source = 'production'
    expect(() => runCognitiveEvaluation(nonSynthetic)).toThrowError(expect.objectContaining({ code: 'INVALID_DATASET' }))
  })
})

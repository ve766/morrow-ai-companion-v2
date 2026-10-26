import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_SCENARIOS,
  BenchmarkError,
  canonical,
  runRetrievalBenchmark,
  summarizeReport,
  validateBenchmarkDataset
} from './retrieval-benchmark'
import { RETRIEVAL_ALGORITHM_V2 } from '../memory/retrieval/retrieval-config'

const fixturePath = resolve(process.cwd(), 'evaluation', 'fixtures', 'retrieval-benchmark-v1.json')

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

function cloneFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
}

describe('benchmark dataset validation', () => {
  it('accepts the committed fixture', () => {
    const dataset = validateBenchmarkDataset(loadFixture())
    expect(dataset.cases.length).toBe(12)
    expect(new Set(dataset.cases.map((item) => item.scenario)).size).toBe(BENCHMARK_SCENARIOS.length)
  })

  it('rejects a dataset that references an unknown expectation id', () => {
    const fixture = cloneFixture()
    const cases = fixture.cases as Array<Record<string, unknown>>
    cases[0]!.expectedRelevantIds = ['does-not-exist']
    expect(() => validateBenchmarkDataset(fixture)).toThrowError(BenchmarkError)
  })

  it('rejects duplicate case ids and unsupported scenarios', () => {
    const duplicate = cloneFixture()
    const cases = duplicate.cases as Array<Record<string, unknown>>
    cases[1]!.id = cases[0]!.id
    expect(() => validateBenchmarkDataset(duplicate)).toThrowError('INVALID_CASE')

    const badScenario = cloneFixture()
    const badCases = badScenario.cases as Array<Record<string, unknown>>
    badCases[0]!.scenario = 'not-a-scenario'
    expect(() => validateBenchmarkDataset(badScenario)).toThrowError('INVALID_CASE')
  })

  it('rejects a memory with an out-of-range confidence instead of coercing it', () => {
    const fixture = cloneFixture()
    const cases = fixture.cases as Array<{ memories: Array<Record<string, unknown>> }>
    cases[0]!.memories[0]!.confidence = 0
    expect(() => validateBenchmarkDataset(fixture)).toThrowError('INVALID_MEMORY')
  })
})

describe('benchmark dataset integrity', () => {
  it('has not been silently edited since it was frozen', () => {
    // If this fails, the fixture changed. That is allowed, but the pinned hash
    // must be updated in the same commit and the frozen report re-baselined, so
    // nobody can quietly move the goalposts.
    const dataset = validateBenchmarkDataset(loadFixture())
    const hash = createHash('sha256').update(canonical(dataset)).digest('hex')
    expect(hash).toBe('5d3cecc8af7d66ff57045813ec10152ed4ff237d078f10466e012ec318545c99')
  })
})

describe('retrieval benchmark on the production algorithms', () => {
  const report = runRetrievalBenchmark(loadFixture())

  it('covers every required scenario and passes the gate', () => {
    expect(report.dataset.scenarios).toHaveLength(BENCHMARK_SCENARIOS.length)
    expect(report.gate.failed).toEqual([])
    expect(report.gate.passed).toBe(true)
    expect(report.activation.recommendedAlgorithm).toBe(RETRIEVAL_ALGORITHM_V2)
  })

  it('removes the cross-record correction leak that v1 exhibits', () => {
    const correction = report.cases.find((item) => item.scenario === 'explicit_correction')
    expect(correction?.v1.leaks).toEqual(['tea-restated'])
    expect(correction?.v2.leaks).toEqual([])
    expect(correction?.v2.reciprocalRank).toBe(1)
  })

  it('never returns a retracted, restricted or superseded memory', () => {
    expect(report.totals.v2.leakCount).toBe(0)
    expect(report.totals.v2.budgetOverruns).toBe(0)
  })

  it('does not regress recall, MRR, NDCG or topic coverage against the baseline', () => {
    expect(report.totals.v2.recallAt5).toBeGreaterThanOrEqual(report.totals.v1.recallAt5)
    expect(report.totals.v2.mrr).toBeGreaterThanOrEqual(report.totals.v1.mrr)
    expect(report.totals.v2.ndcgAt5).toBeGreaterThanOrEqual(report.totals.v1.ndcgAt5)
    expect(report.totals.v2.topicCoverage).toBeGreaterThanOrEqual(report.totals.v1.topicCoverage)
  })

  it('is deterministic across repeated runs', () => {
    const second = runRetrievalBenchmark(loadFixture())
    expect(second.cases.map((item) => item.v2.selectedIds)).toEqual(report.cases.map((item) => item.v2.selectedIds))
    expect(report.totals.v1.deterministic).toBe(true)
    expect(report.totals.v2.deterministic).toBe(true)
  })

  it('prints a summary that names the recommended algorithm', () => {
    const summary = JSON.parse(summarizeReport(report)) as { passed: boolean; recommended: string }
    expect(summary.passed).toBe(true)
    expect(summary.recommended).toBe(RETRIEVAL_ALGORITHM_V2)
  })
})

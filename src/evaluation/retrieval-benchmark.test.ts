import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RetrievalBenchmarkError,
  parseRetrievalDataset,
  runRetrievalBenchmark,
  type RetrievalBenchmarkDataset
} from './retrieval-benchmark'

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'evaluation', 'fixtures', 'retrieval-context-v1.json'), 'utf8')
) as unknown

function byId(report: ReturnType<typeof runRetrievalBenchmark>, id: string) {
  const found = report.cases.find((item) => item.id === id)
  if (!found) throw new Error(`missing case ${id}`)
  return found
}

describe('production retrieval benchmark', () => {
  it('shows the baseline false positive and the shipped rule rejecting it', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    const an = byId(report, 'substring-an-analyst')
    expect(an.baseline.retrieved).toContain('analyst')
    expect(an.candidate.retrieved).not.toContain('analyst')

    const dog = byId(report, 'substring-do-dog')
    expect(dog.baseline.retrieved).toContain('dog')
    expect(dog.candidate.retrieved).not.toContain('dog')

    const number = byId(report, 'substring-number')
    expect(number.baseline.retrieved).toContain('plan')
    expect(number.candidate.retrieved).not.toContain('plan')
  })

  it('shows the context-only recall that the baseline cannot make', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    const elliptical = byId(report, 'context-pronoun')
    expect(elliptical.baseline.retrieved).toEqual([])
    expect(elliptical.candidate.retrieved).toEqual(['hangzhou'])
  })

  it('keeps retraction and sensitivity as hard boundaries on both sides', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    expect(byId(report, 'retracted-old-value').candidate.leaks).toEqual([])
    expect(byId(report, 'retracted-old-value').baseline.leaks).toEqual([])
    expect(byId(report, 'sensitive-unauthorised').candidate.leaks).toEqual([])
    expect(byId(report, 'sensitive-unauthorised').baseline.leaks).toEqual([])
    expect(report.candidate.leakCount).toBe(0)
  })

  it('allows the same sensitive record once the ceiling is raised', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    expect(byId(report, 'sensitive-authorised').candidate.retrieved).toEqual(['health'])
  })

  it('records the known semantic gap as a miss for both, not as a win', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    const gap = byId(report, 'semantic-gap-vinyl')
    expect(gap.baseline.retrieved).not.toContain('vinyl')
    expect(gap.candidate.retrieved).not.toContain('vinyl')
  })

  it('aggregates the expected direction of change on this fixture', () => {
    const report = runRetrievalBenchmark(parseRetrievalDataset(fixture))
    // The shipped rule fixes three false positives and adds one context-only
    // recall; both are visible in the aggregate, not only per case.
    expect(report.candidate.falseRecall).toBeLessThan(report.baseline.falseRecall)
    expect(report.candidate.recallAt3).toBeGreaterThan(report.baseline.recallAt3)
    expect(report.determinism.replayStable).toBe(true)
    expect(report.dataset.caseCount).toBe(parseRetrievalDataset(fixture).cases.length)
  })

  it('rejects unknown fields and dangling memory references', () => {
    const base = {
      schemaVersion: 1,
      id: 'probe',
      cases: [{
        id: 'c1',
        query: 'q',
        memories: [{ id: 'm1', content: 'x' }],
        relevant: ['m1']
      }]
    }
    expect(() => parseRetrievalDataset({ ...base, cases: [{ ...base.cases[0], typo: 1 }] }))
      .toThrowError(expect.objectContaining({ code: 'UNKNOWN_FIELD:c1:typo' }))
    expect(() => parseRetrievalDataset({ ...base, cases: [{ ...base.cases[0], relevant: ['missing'] }] }))
      .toThrowError(expect.objectContaining({ code: 'UNKNOWN_MEMORY_REFERENCE:c1:missing' }))
    expect(() => parseRetrievalDataset({ ...base, cases: [{ ...base.cases[0], memories: [] }] }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_MEMORIES:c1' }))
  })

  it('is deterministic across repeated runs', () => {
    const dataset: RetrievalBenchmarkDataset = parseRetrievalDataset(fixture)
    const first = runRetrievalBenchmark(dataset)
    const second = runRetrievalBenchmark(dataset)
    expect(second.determinism.resultHash).toBe(first.determinism.resultHash)
    expect(second.candidate).toEqual(first.candidate)
  })

  it('fails closed on a malformed dataset instead of reporting zero cases', () => {
    expect(() => parseRetrievalDataset({ schemaVersion: 1, id: 'x', cases: [] }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_DATASET' }))
    expect(() => parseRetrievalDataset({ schemaVersion: 2, id: 'x', cases: [{}] }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }))
    expect(() => parseRetrievalDataset(null)).toThrow(RetrievalBenchmarkError)
  })
})

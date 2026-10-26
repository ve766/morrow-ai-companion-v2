import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPANION_CORE_DIMENSIONS,
  CompanionCoreEvaluationError,
  parseCompanionCoreDataset,
  runCompanionCoreEvaluation
} from './companion-core-evaluation'

const fixturePath = resolve(process.cwd(), 'evaluation', 'fixtures', 'companion-core-v1.json')

function loadDataset(): unknown {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
}

describe('companion core evaluation', () => {
  it('passes every case and covers all ten required dimensions', async () => {
    const dataset = parseCompanionCoreDataset(loadDataset())
    const report = await runCompanionCoreEvaluation(dataset)

    expect(report.gate.failedChecks).toEqual([])
    expect(report.gate.passed).toBe(true)
    expect(report.metrics.failed).toBe(0)
    expect(report.metrics.cases).toBe(dataset.cases.length)
    for (const dimension of COMPANION_CORE_DIMENSIONS) {
      expect(report.metrics.dimensionCoverage[dimension]).toBeGreaterThan(0)
    }
  })

  it('replays deterministically and never touches the network', async () => {
    const dataset = parseCompanionCoreDataset(loadDataset())
    const report = await runCompanionCoreEvaluation(dataset)

    expect(report.determinism.replayStable).toBe(true)
    expect(report.determinism.resultHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(report.offlineExecution).toMatchObject({ networkCalls: 0, networkGuarded: true, providerClass: 'deterministic_stub' })
  })

  it('rejects an unknown dimension instead of silently scoring it', () => {
    const dataset = loadDataset() as { cases: Array<Record<string, unknown>> }
    dataset.cases[0]!.dimension = 'made_up_dimension'
    expect(() => parseCompanionCoreDataset(dataset)).toThrowError(CompanionCoreEvaluationError)
  })

  it('rejects duplicate case ids so a covered case cannot be shadowed', () => {
    const dataset = loadDataset() as { cases: Array<Record<string, unknown>> }
    dataset.cases[1]!.id = dataset.cases[0]!.id
    expect(() => parseCompanionCoreDataset(dataset)).toThrowError(/DUPLICATE_CASE_ID/u)
  })
})

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

  it('labels its own evidence class so the report cannot be read as model evidence', async () => {
    const report = await runCompanionCoreEvaluation(parseCompanionCoreDataset(loadDataset()))
    expect(report.evidenceClass).toBe('offline_deterministic_stub')
    expect(report.offlineExecution.networkCalls).toBe(0)
  })
})

describe('the dataset schema is closed, not permissive', () => {
  function singleCase(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id: 'schema-probe',
      cases: [{
        id: 'probe-01',
        dimension: 'payload_integrity',
        steps: [{ type: 'send', content: '你好' }],
        expect: { providerCalls: 1 },
        ...overrides
      }]
    }
  }

  it('rejects an unknown key on a case', () => {
    expect(() => parseCompanionCoreDataset(singleCase({ sentinel: true }))).toThrowError(/UNKNOWN_FIELD/u)
  })

  it('rejects an unknown key inside expect, including a near-miss spelling', () => {
    // The failure this prevents: a typo like `systemContain` used to be ignored,
    // so the case passed while asserting nothing at all.
    expect(() => parseCompanionCoreDataset(singleCase({ expect: { systemContain: ['x'] } }))).toThrowError(/UNKNOWN_FIELD/u)
  })

  it('rejects an unknown key on a step or a memory spec', () => {
    expect(() => parseCompanionCoreDataset(singleCase({ steps: [{ type: 'send', content: '你好', sensitive: true }] }))).toThrowError(/UNKNOWN_FIELD/u)
    expect(() => parseCompanionCoreDataset(singleCase({ memories: [{ content: '事实', age: 3 }] }))).toThrowError(/UNKNOWN_FIELD/u)
  })

  it('rejects an unknown step type, provider mode and dataset key', () => {
    expect(() => parseCompanionCoreDataset(singleCase({ steps: [{ type: 'teleport', content: '你好' }] }))).toThrowError(/UNKNOWN_STEP_TYPE/u)
    expect(() => parseCompanionCoreDataset(singleCase({ providerMode: 'sometimes' }))).toThrowError(/UNKNOWN_PROVIDER_MODE/u)
    expect(() => parseCompanionCoreDataset({ ...singleCase({}), extra: 1 })).toThrowError(/UNKNOWN_FIELD/u)
  })

  it('rejects a malformed history expectation instead of ignoring it', () => {
    expect(() => parseCompanionCoreDataset(singleCase({ expect: { history: [{ role: 'user' }] } }))).toThrowError(/INVALID_EXPECTATION/u)
    expect(() => parseCompanionCoreDataset(singleCase({ expect: { history: [{ role: 'user', content: 'x', note: 'y' }] } }))).toThrowError(/UNKNOWN_FIELD/u)
  })
})

describe('every assertion the fixture can express is actually executed', () => {
  function dataset(caseOverrides: Record<string, unknown>, expectOverrides: Record<string, unknown>): Parameters<typeof runCompanionCoreEvaluation>[0] {
    return parseCompanionCoreDataset({
      schemaVersion: 1,
      id: 'assertion-probe',
      cases: [{
        id: 'probe-01',
        dimension: 'multi_turn_context',
        steps: [{ type: 'send', content: '第一句。' }, { type: 'send', content: '第二句。' }],
        expect: { providerCalls: 2, ...expectOverrides },
        ...caseOverrides
      }]
    })
  }

  it('fails a case whose history expectation does not match what was sent', async () => {
    const report = await runCompanionCoreEvaluation(dataset({}, {
      history: [{ role: 'user', content: '第一句。' }, { role: 'assistant', content: '错误的回复' }]
    }))
    expect(report.cases[0]!.passed).toBe(false)
    expect(report.cases[0]!.failures.join('\n')).toContain('history 1')
  })

  it('passes the same case when the history expectation is correct', async () => {
    const report = await runCompanionCoreEvaluation(dataset({}, {
      history: [{ role: 'user', content: '第一句。' }, { role: 'assistant', content: '确定性回复 1' }]
    }))
    expect(report.cases[0]!.failures).toEqual([])
    expect(report.cases[0]!.passed).toBe(true)
  })

  it('fails a case whose memory count expectation is wrong', async () => {
    const report = await runCompanionCoreEvaluation(dataset({ memories: [{ content: '我住在杭州。' }] }, { memoryCount: 5 }))
    expect(report.cases[0]!.passed).toBe(false)
    expect(report.cases[0]!.failures.join('\n')).toContain('memory count')
  })

  it('fails a case whose excluded content is still present', async () => {
    const report = await runCompanionCoreEvaluation(dataset({ memories: [{ content: 'MEM_PROBE_LEAK 在这里。' }] }, { excludeContents: ['MEM_PROBE_LEAK'] }))
    expect(report.cases[0]!.passed).toBe(false)
    expect(report.cases[0]!.failures.join('\n')).toContain('still contains')
  })

  it('fails when an earlier step throws even if the final step produces the expected code', async () => {
    // The previous engine tracked only the last error, so this case passed while
    // step 0 had failed for an unrelated reason.
    const probe = parseCompanionCoreDataset({
      schemaVersion: 1,
      id: 'attribution-probe',
      cases: [{
        id: 'probe-01',
        dimension: 'provider_failure',
        providerMode: 'auth',
        steps: [
          { type: 'correct', memoryIndex: 9, content: '不存在' },
          { type: 'send', content: '你好。' }
        ],
        expect: { errorCode: 'PROVIDER_AUTH' }
      }]
    })
    const report = await runCompanionCoreEvaluation(probe)
    expect(report.cases[0]!.passed).toBe(false)
    expect(report.cases[0]!.failures.join('\n')).toContain('2 steps threw')
  })

  it('fails when an error is expected but nothing throws', async () => {
    const report = await runCompanionCoreEvaluation(dataset({}, { errorCode: 'PROVIDER_AUTH' }))
    expect(report.cases[0]!.passed).toBe(false)
    expect(report.cases[0]!.failures.join('\n')).toContain('no step threw')
  })

  it('fails when the error came from a step other than the last', async () => {
    const probe = parseCompanionCoreDataset({
      schemaVersion: 1,
      id: 'attribution-probe',
      cases: [{
        id: 'probe-01',
        dimension: 'provider_failure',
        steps: [
          { type: 'correct', memoryIndex: 9, content: '不存在' },
          { type: 'send', content: '你好。' }
        ],
        expect: { errorCode: 'PROVIDER_AUTH' }
      }]
    })
    const report = await runCompanionCoreEvaluation(probe)
    expect(report.cases[0]!.passed).toBe(false)
    const failures = report.cases[0]!.failures.join('\n')
    expect(failures).toContain('error came from step 0, not the final step 1')
    expect(failures).toContain('error code expected PROVIDER_AUTH got UNEXPECTED_ERROR')
  })
})

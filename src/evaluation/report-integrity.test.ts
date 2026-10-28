import { describe, expect, it } from 'vitest'
import { validateReportIntegrity, type IntegrityReport } from './report-integrity'
import type { RequestRecord } from './request-ledger'

/**
 * Phase 2.1.1 A3: a report whose request records and per-run references do not
 * agree must fail validation, because every rate in it depends on that link.
 */

function record(overrides: Partial<RequestRecord> & Pick<RequestRecord, 'requestId' | 'purpose'>): RequestRecord {
  return {
    sequence: 1,
    scenarioId: 'fact-query',
    scenarioRunId: 'fact-query#0',
    conversationId: 'conv-1',
    status: 'succeeded',
    startedAt: '2026-10-28T00:00:00.000Z',
    finishedAt: '2026-10-28T00:00:01.000Z',
    errorCode: null,
    failureLayer: 'none',
    ...overrides
  }
}

function report(overrides: Partial<IntegrityReport> = {}): IntegrityReport {
  const requests = [
    record({ requestId: 'req-main', purpose: 'primary' }),
    record({ requestId: 'req-probe', purpose: 'probe' })
  ]
  return {
    counts: {
      scenarioRuns: 1,
      providerRequestsAttempted: 2,
      providerRequestsSucceeded: 2,
      providerRequestsFailed: 0,
      providerRequestsCancelled: 0,
      primaryAnswerRequests: 1,
      auxiliaryProbeRequests: 1,
      setupRequests: 0
    },
    requests,
    runs: [{ runId: 'fact-query#0', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: 'req-main', probeRequestIds: ['req-probe'], setupRequestIds: [], callSucceeded: true }],
    ...overrides
  }
}

describe('phase 2.1.1 A3: report integrity invariants', () => {
  it('accepts a consistent report and recomputes the counts', () => {
    const result = validateReportIntegrity(report())
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.recomputed).toMatchObject({ attempted: 2, succeeded: 2, failed: 0, cancelled: 0, primary: 1, probe: 1, setup: 0, scenarioRuns: 1 })
  })

  it('rejects a report whose primary answer points at the probe request', () => {
    const broken = report({ runs: [{ runId: 'fact-query#0', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: 'req-probe', probeRequestIds: ['req-probe'], setupRequestIds: [], callSucceeded: true }] })
    const result = validateReportIntegrity(broken)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/purpose probe, expected primary/)
  })

  it('rejects a request id used twice', () => {
    const duplicated = report({ requests: [record({ requestId: 'req-main', purpose: 'primary' }), record({ requestId: 'req-main', purpose: 'primary' })] })
    expect(validateReportIntegrity(duplicated).failures.join(' ')).toMatch(/duplicate request id/)
  })

  it('rejects a request without a terminal state', () => {
    const started = report({ requests: [record({ requestId: 'req-main', purpose: 'primary', status: 'started', finishedAt: null, failureLayer: null }), record({ requestId: 'req-probe', purpose: 'probe' })] })
    const result = validateReportIntegrity(started)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/no terminal status/)
  })

  it('rejects counts that do not match the records', () => {
    const wrong = report({ counts: { ...report().counts, providerRequestsFailed: 3 } })
    expect(validateReportIntegrity(wrong).failures.join(' ')).toMatch(/counts\.providerRequestsFailed/)
  })

  it('rejects a successful answer recorded on a failed request', () => {
    const failedPrimary = report({
      requests: [record({ requestId: 'req-main', purpose: 'primary', status: 'failed', failureLayer: 'provider', errorCode: 'PROVIDER_NETWORK' }), record({ requestId: 'req-probe', purpose: 'probe' })],
      counts: { ...report().counts, providerRequestsSucceeded: 1, providerRequestsFailed: 1 }
    })
    const result = validateReportIntegrity(failedPrimary)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/successful answer on a failed primary request/)
  })

  it('rejects a run whose probe id belongs to another scenario run', () => {
    const crossed = report({
      requests: [record({ requestId: 'req-main', purpose: 'primary' }), record({ requestId: 'req-probe', purpose: 'probe', scenarioRunId: 'fact-query#1' })],
      runs: [{ runId: 'fact-query#0', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: 'req-main', probeRequestIds: ['req-probe'], setupRequestIds: [], callSucceeded: true }]
    })
    expect(validateReportIntegrity(crossed).failures.join(' ')).toMatch(/belongs to run fact-query#1/)
  })

  it('rejects a request that no run references', () => {
    const orphan = report({
      requests: [record({ requestId: 'req-main', purpose: 'primary' }), record({ requestId: 'req-probe', purpose: 'probe' }), record({ requestId: 'req-orphan', purpose: 'setup' })],
      counts: { ...report().counts, providerRequestsAttempted: 3, providerRequestsSucceeded: 3, setupRequests: 1 }
    })
    expect(validateReportIntegrity(orphan).failures.join(' ')).toMatch(/not referenced by any run/)
  })

  it('rejects the same request being referenced by two runs', () => {
    const shared = report({
      counts: { ...report().counts, scenarioRuns: 2, auxiliaryProbeRequests: 1 },
      runs: [
        { runId: 'fact-query#0', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: 'req-main', probeRequestIds: ['req-probe'], setupRequestIds: [], callSucceeded: true },
        { runId: 'fact-query#1', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: 'req-main', probeRequestIds: [], setupRequestIds: [], callSucceeded: true }
      ]
    })
    expect(validateReportIntegrity(shared).failures.join(' ')).toMatch(/referenced by fact-query#0 and fact-query#1/)
  })

  it('rejects a successful run without any primary request', () => {
    const missing = report({
      runs: [{ runId: 'fact-query#0', scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', primaryRequestId: null, probeRequestIds: ['req-main', 'req-probe'], setupRequestIds: [], callSucceeded: true }]
    })
    const result = validateReportIntegrity(missing)
    expect(result.ok).toBe(false)
    expect(result.failures.join(' ')).toMatch(/successful answer without a primary request/)
  })
})

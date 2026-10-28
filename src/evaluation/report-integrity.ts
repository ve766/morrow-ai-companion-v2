/**
 * Integrity checks for a benchmark report (Phase 2.1.1, work package A3).
 *
 * The report is data, and data can be internally inconsistent: a request id
 * that points at the wrong call, a count that does not match the records, a
 * run that claims success on a failed request. These checks run before the
 * report is written, and a failure makes the benchmark exit non-zero instead
 * of producing a clean-looking report.
 */
import type { RequestRecord, RequestStatus } from './request-ledger'

export interface IntegrityRun {
  runId: string
  scenarioId: string
  scenarioRunId: string
  primaryRequestId: string | null
  probeRequestIds: readonly string[]
  setupRequestIds: readonly string[]
  callSucceeded: boolean
}

export interface IntegrityCounts {
  scenarioRuns?: number
  providerRequestsAttempted?: number
  providerRequestsSucceeded?: number
  providerRequestsFailed?: number
  providerRequestsCancelled?: number
  primaryAnswerRequests?: number
  auxiliaryProbeRequests?: number
  setupRequests?: number
}

export interface IntegrityReport {
  counts: IntegrityCounts
  requests: readonly RequestRecord[]
  runs: readonly IntegrityRun[]
}

export interface IntegrityResult {
  ok: boolean
  failures: string[]
  recomputed: {
    attempted: number
    succeeded: number
    failed: number
    cancelled: number
    primary: number
    probe: number
    setup: number
    scenarioRuns: number
  }
}

const TERMINAL: ReadonlySet<RequestStatus> = new Set(['succeeded', 'failed', 'cancelled'])

function sameOwner(record: RequestRecord, run: IntegrityRun, purpose: RequestRecord['purpose']): string | null {
  if (record.purpose !== purpose) return `request ${record.requestId} has purpose ${record.purpose}, expected ${purpose}`
  if (record.scenarioId !== run.scenarioId) return `request ${record.requestId} belongs to ${record.scenarioId}, expected ${run.scenarioId}`
  if (record.scenarioRunId !== run.scenarioRunId) return `request ${record.requestId} belongs to run ${record.scenarioRunId}, expected ${run.scenarioRunId}`
  return null
}

export function validateReportIntegrity(report: IntegrityReport): IntegrityResult {
  const failures: string[] = []
  const requests = report.requests
  const byId = new Map<string, RequestRecord>()

  for (const record of requests) {
    if (byId.has(record.requestId)) failures.push(`duplicate request id: ${record.requestId}`)
    byId.set(record.requestId, record)
    if (!TERMINAL.has(record.status)) failures.push(`request ${record.requestId} has no terminal status (${record.status})`)
    if (record.finishedAt === null) failures.push(`request ${record.requestId} has no finishedAt`)
    if (record.status === 'succeeded' && record.failureLayer !== 'none') failures.push(`request ${record.requestId} succeeded but has failureLayer ${record.failureLayer}`)
    if (record.status !== 'succeeded' && record.failureLayer === 'none') failures.push(`request ${record.requestId} did not succeed but reports failureLayer none`)
  }

  const count = (status: RequestStatus): number => requests.filter((record) => record.status === status).length
  const byPurpose = (purpose: RequestRecord['purpose']): number => requests.filter((record) => record.purpose === purpose).length
  const recomputed = {
    attempted: requests.length,
    succeeded: count('succeeded'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    primary: byPurpose('primary'),
    probe: byPurpose('probe'),
    setup: byPurpose('setup'),
    scenarioRuns: report.runs.length
  }

  // attempted = succeeded + failed + cancelled, and nothing may be left started.
  if (recomputed.attempted !== recomputed.succeeded + recomputed.failed + recomputed.cancelled) {
    failures.push(`attempted ${recomputed.attempted} != succeeded+failed+cancelled ${recomputed.succeeded + recomputed.failed + recomputed.cancelled}`)
  }

  const expected: Array<[keyof IntegrityCounts, number]> = [
    ['scenarioRuns', recomputed.scenarioRuns],
    ['providerRequestsAttempted', recomputed.attempted],
    ['providerRequestsSucceeded', recomputed.succeeded],
    ['providerRequestsFailed', recomputed.failed],
    ['providerRequestsCancelled', recomputed.cancelled],
    ['primaryAnswerRequests', recomputed.primary],
    ['auxiliaryProbeRequests', recomputed.probe],
    ['setupRequests', recomputed.setup]
  ]
  for (const [key, value] of expected) {
    const declared = report.counts[key]
    if (declared !== undefined && declared !== value) failures.push(`counts.${key} is ${declared}, recomputed ${value}`)
  }

  const referenced = new Map<string, string>()
  for (const run of report.runs) {
    const ids = [run.primaryRequestId, ...run.probeRequestIds, ...run.setupRequestIds].filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) failures.push(`run ${run.runId} references no request`)
    for (const id of ids) {
      if (referenced.has(id)) failures.push(`request ${id} is referenced by ${referenced.get(id)} and ${run.runId}`)
      else referenced.set(id, run.runId)
    }
    if (run.primaryRequestId) {
      const record = byId.get(run.primaryRequestId)
      if (!record) failures.push(`run ${run.runId} references unknown primary request ${run.primaryRequestId}`)
      else {
        const problem = sameOwner(record, run, 'primary')
        if (problem) failures.push(`run ${run.runId}: ${problem}`)
        if (run.callSucceeded && record.status !== 'succeeded') failures.push(`run ${run.runId} reports a successful answer on a ${record.status} primary request`)
        if (!run.callSucceeded && record.status === 'succeeded') failures.push(`run ${run.runId} reports a failed call on a succeeded primary request`)
      }
    } else if (run.callSucceeded) {
      failures.push(`run ${run.runId} reports a successful answer without a primary request`)
    }
    for (const id of run.probeRequestIds) {
      const record = byId.get(id)
      if (!record) failures.push(`run ${run.runId} references unknown probe request ${id}`)
      else {
        const problem = sameOwner(record, run, 'probe')
        if (problem) failures.push(`run ${run.runId}: ${problem}`)
      }
    }
    for (const id of run.setupRequestIds) {
      const record = byId.get(id)
      if (!record) failures.push(`run ${run.runId} references unknown setup request ${id}`)
      else {
        const problem = sameOwner(record, run, 'setup')
        if (problem) failures.push(`run ${run.runId}: ${problem}`)
      }
    }
  }

  // Every recorded request must belong to exactly one run.
  const referencedIds = new Set(referenced.keys())
  for (const record of requests) {
    if (!referencedIds.has(record.requestId)) failures.push(`request ${record.requestId} is not referenced by any run`)
  }

  return { ok: failures.length === 0, failures, recomputed }
}

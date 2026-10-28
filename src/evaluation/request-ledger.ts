/**
 * Provider-request ledger for the Phase-2.1.1 benchmark.
 *
 * A scenario run is not a provider request: one run can send a setup turn, a
 * primary question and an auxiliary probe. The ledger records every call at
 * the provider boundary, and every record is owned by exactly one scenario
 * run, so a rate can be traced back to the calls that produced it.
 *
 * Two invariants matter and are enforced here rather than in the report:
 *   - a request id is unique; re-using one is an integrity error, not a merge
 *   - a request ends exactly once, with a terminal status
 */
export type RequestPurpose = 'primary' | 'probe' | 'setup'
export type RequestStatus = 'started' | 'succeeded' | 'failed' | 'cancelled'
export type RequestFailureLayer = 'none' | 'provider' | 'unknown'

export interface RequestScope {
  scenarioId: string
  scenarioRunId: string
  purpose: RequestPurpose
  requestId: string
  conversationId?: string | null
}

export interface RequestRecord {
  sequence: number
  requestId: string
  scenarioId: string
  scenarioRunId: string
  purpose: RequestPurpose
  conversationId: string | null
  status: RequestStatus
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  failureLayer: RequestFailureLayer | null
}

export interface RequestCounts {
  /** Records created at the provider boundary: every one was actually attempted. */
  attempted: number
  succeeded: number
  failed: number
  cancelled: number
  /** Attempted calls that never reached a terminal status (must be 0 when reported). */
  startedOnly: number
  primary: number
  probe: number
  setup: number
}

const TERMINAL: ReadonlySet<RequestStatus> = new Set(['succeeded', 'failed', 'cancelled'])

export class RequestLedger {
  readonly records: RequestRecord[] = []
  private current: RequestScope = { scenarioId: '', scenarioRunId: '', purpose: 'primary', requestId: '' }
  private sequence = 0

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  /** Declares the owner of the next call. Duplicate ids are rejected. */
  scope(scope: RequestScope): void {
    if (typeof scope.scenarioId !== 'string' || scope.scenarioId.length === 0) throw new TypeError('A request scope needs a scenario id.')
    if (typeof scope.scenarioRunId !== 'string' || scope.scenarioRunId.length === 0) throw new TypeError('A request scope needs a scenario run id.')
    if (typeof scope.requestId !== 'string' || scope.requestId.length === 0) throw new TypeError('A request scope needs a request id.')
    this.current = { ...scope }
  }

  /** Records that a call is starting. The record exists even if the call throws. */
  begin(): RequestRecord {
    const { requestId } = this.current
    if (this.records.some((record) => record.requestId === requestId)) {
      throw new TypeError(`Duplicate request id: ${requestId}`)
    }
    this.sequence += 1
    const record: RequestRecord = {
      sequence: this.sequence,
      requestId,
      scenarioId: this.current.scenarioId,
      scenarioRunId: this.current.scenarioRunId,
      purpose: this.current.purpose,
      conversationId: this.current.conversationId ?? null,
      status: 'started',
      startedAt: this.clock(),
      finishedAt: null,
      errorCode: null,
      failureLayer: null
    }
    this.records.push(record)
    return record
  }

  finish(record: RequestRecord, status: Exclude<RequestStatus, 'started'>, errorCode: string | null = null): void {
    if (!TERMINAL.has(status)) throw new TypeError('A request must end with a terminal status.')
    if (TERMINAL.has(record.status)) throw new TypeError(`Request ${record.requestId} was already finished.`)
    record.status = status
    record.finishedAt = this.clock()
    record.errorCode = errorCode
    // "Provider" means the call reached the adapter and came back as an error.
    // Anything else is recorded as unknown rather than guessed.
    record.failureLayer = status === 'succeeded' ? 'none' : errorCode === null ? 'unknown' : 'provider'
  }

  /** Runs the call, records it, and rethrows so the caller cannot swallow it. */
  async track<T>(call: () => Promise<T>, classify: (error: unknown) => 'failed' | 'cancelled' = () => 'failed'): Promise<T> {
    const record = this.begin()
    try {
      const result = await call()
      this.finish(record, 'succeeded')
      return result
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.name : 'unknown'
      this.finish(record, classify(error), code)
      throw error
    }
  }

  counts(): RequestCounts {
    const count = (status: RequestStatus): number => this.records.filter((record) => record.status === status).length
    const byPurpose = (purpose: RequestPurpose): number => this.records.filter((record) => record.purpose === purpose).length
    return {
      attempted: this.records.length,
      succeeded: count('succeeded'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      startedOnly: count('started'),
      primary: byPurpose('primary'),
      probe: byPurpose('probe'),
      setup: byPurpose('setup')
    }
  }

  /** Records that belong to one request id, so a metric can point at its rows. */
  forRequestIds(ids: readonly string[]): RequestRecord[] {
    const wanted = new Set(ids)
    return this.records.filter((record) => wanted.has(record.requestId))
  }
}

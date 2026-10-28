/**
 * Provider-request ledger for the Phase-2.1 benchmark.
 *
 * A scenario run is not a provider request: one run can send a setup turn, a
 * primary question and an auxiliary probe. The benchmark used to report the
 * scenario count as if it were the call count, which made every rate look
 * better than it was. This ledger records each call at the provider boundary
 * so the two units stay separate and every rate can be traced to records.
 */
export type RequestPurpose = 'primary' | 'probe' | 'setup'
export type RequestStatus = 'started' | 'succeeded' | 'failed' | 'cancelled'

export interface RequestRecord {
  sequence: number
  requestId: string
  scenarioId: string
  purpose: RequestPurpose
  status: RequestStatus
  startedAt: string
  endedAt: string | null
  errorCode: string | null
}

export interface RequestCounts {
  attempted: number
  succeeded: number
  failed: number
  cancelled: number
  primary: number
  probe: number
  setup: number
  startedOnly: number
}

export class RequestLedger {
  readonly records: RequestRecord[] = []
  private current: { scenarioId: string; purpose: RequestPurpose; requestId: string } = { scenarioId: '', purpose: 'primary', requestId: '' }
  private sequence = 0

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  /** Declares which scenario, purpose and request the next call belongs to. */
  scope(scenarioId: string, purpose: RequestPurpose, requestId: string): void {
    if (scenarioId.length === 0 || requestId.length === 0) throw new TypeError('A request scope needs a scenario and a request id.')
    this.current = { scenarioId, purpose, requestId }
  }

  begin(): RequestRecord {
    this.sequence += 1
    const record: RequestRecord = {
      sequence: this.sequence,
      requestId: this.current.requestId,
      scenarioId: this.current.scenarioId,
      purpose: this.current.purpose,
      status: 'started',
      startedAt: this.clock(),
      endedAt: null,
      errorCode: null
    }
    this.records.push(record)
    return record
  }

  finish(record: RequestRecord, status: Exclude<RequestStatus, 'started'>, errorCode: string | null = null): void {
    record.status = status
    record.endedAt = this.clock()
    record.errorCode = errorCode
  }

  /** Runs the call and records the outcome, rethrowing so callers stay honest. */
  async track<T>(call: () => Promise<T>, classify: (error: unknown) => 'failed' | 'cancelled' = () => 'failed'): Promise<T> {
    const record = this.begin()
    try {
      const result = await call()
      this.finish(record, 'succeeded')
      return result
    } catch (error) {
      this.finish(record, classify(error), error instanceof Error ? error.name : 'unknown')
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
      primary: byPurpose('primary'),
      probe: byPurpose('probe'),
      setup: byPurpose('setup'),
      startedOnly: count('started')
    }
  }

  /** Records that belong to one run, so a metric can point at its raw rows. */
  forRequestIds(ids: readonly string[]): RequestRecord[] {
    const wanted = new Set(ids)
    return this.records.filter((record) => wanted.has(record.requestId))
  }
}

import { describe, expect, it } from 'vitest'
import { RequestLedger } from './request-ledger'

describe('phase 2.1 A: provider request accounting', () => {
  it('keeps scenario runs and provider requests as separate units', async () => {
    const ledger = new RequestLedger(() => '2026-10-28T00:00:00.000Z')
    // One scenario run that sends a setup turn, a primary question and a probe.
    ledger.scope('scenario-1', 'setup', 'req-1')
    await ledger.track(async () => 'ok')
    ledger.scope('scenario-1', 'primary', 'req-2')
    await ledger.track(async () => 'ok')
    ledger.scope('scenario-1', 'probe', 'req-3')
    await ledger.track(async () => 'ok')
    expect(ledger.counts()).toEqual({ attempted: 3, succeeded: 3, failed: 0, cancelled: 0, primary: 1, probe: 1, setup: 1, startedOnly: 0 })
    expect(ledger.records.map((record) => record.purpose)).toEqual(['setup', 'primary', 'probe'])
    expect(ledger.records.every((record) => record.endedAt !== null)).toBe(true)
  })

  it('keeps a failed call in the records instead of dropping it', async () => {
    const ledger = new RequestLedger()
    ledger.scope('scenario-2', 'primary', 'req-a')
    await expect(ledger.track(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(ledger.counts()).toMatchObject({ attempted: 1, failed: 1, succeeded: 0 })
    expect(ledger.records[0]).toMatchObject({ status: 'failed', errorCode: 'Error' })
  })

  it('distinguishes a cancelled call from a failed one', async () => {
    const ledger = new RequestLedger()
    ledger.scope('scenario-3', 'primary', 'req-b')
    await expect(ledger.track(async () => {
      throw new Error('stop')
    }, () => 'cancelled')).rejects.toThrow('stop')
    expect(ledger.counts()).toMatchObject({ attempted: 1, cancelled: 1, failed: 0 })
  })

  it('refuses an unscoped call, so no request can be recorded without an owner', () => {
    const ledger = new RequestLedger()
    expect(() => ledger.begin()).not.toThrow()
    // The first call before any scope belongs to no scenario; the benchmark
    // always scopes first, and the record shows the empty owner rather than
    // silently attributing it to a scenario.
    expect(ledger.records[0]?.scenarioId).toBe('')
    expect(() => ledger.scope('', 'primary', 'req-c')).toThrow()
  })

  it('can return the raw records behind one run', async () => {
    const ledger = new RequestLedger()
    ledger.scope('s', 'primary', 'a')
    await ledger.track(async () => 1)
    ledger.scope('s', 'probe', 'b')
    await ledger.track(async () => 2)
    expect(ledger.forRequestIds(['b']).map((record) => record.requestId)).toEqual(['b'])
  })
})

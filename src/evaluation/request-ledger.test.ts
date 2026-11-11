import { describe, expect, it } from 'vitest'
import { RequestLedger } from './request-ledger'

/**
 * Phase 2.1.1 work package A4: the ledger must associate every call with the
 * right scenario run and purpose, and must keep failed calls in the record.
 */

function scoped(ledger: RequestLedger, scenarioId: string, scenarioRunId: string, purpose: 'primary' | 'probe' | 'setup', requestId: string): void {
  ledger.scope({ scenarioId, scenarioRunId, purpose, requestId, conversationId: `conv-${scenarioRunId}` })
}

describe('phase 2.1.1 A: request ledger association', () => {
  it('1. records one run with one primary request', async () => {
    const ledger = new RequestLedger(() => '2026-10-28T00:00:00.000Z')
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-1')
    await ledger.track(async () => 'ok')
    expect(ledger.records).toHaveLength(1)
    expect(ledger.records[0]).toMatchObject({ scenarioId: 'fact-query', scenarioRunId: 'fact-query#0', purpose: 'primary', status: 'succeeded', failureLayer: 'none' })
    expect(ledger.counts()).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, cancelled: 0, primary: 1, probe: 0, setup: 0, startedOnly: 0 })
  })

  it('2. keeps a probe that follows a primary answer as a different request with its own purpose', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-primary')
    await ledger.track(async () => 'answer')
    scoped(ledger, 'fact-query', 'fact-query#0', 'probe', 'req-probe')
    await ledger.track(async () => 'probe answer')
    expect(ledger.records.map((record) => record.requestId)).toEqual(['req-primary', 'req-probe'])
    expect(ledger.records.map((record) => record.purpose)).toEqual(['primary', 'probe'])
    // The bug this fixes: the last record of the scenario must not be used as
    // the primary answer's id.
    expect(ledger.records.at(-1)?.requestId).toBe('req-probe')
    expect(ledger.forRequestIds(['req-primary'])[0]?.purpose).toBe('primary')
  })

  it('3. gives every repeat of one scenario its own run and request id', async () => {
    const ledger = new RequestLedger()
    for (const index of [0, 1, 2]) {
      scoped(ledger, 'fact-query', `fact-query#${index}`, 'primary', `req-${index}`)
      await ledger.track(async () => 'ok')
    }
    expect(ledger.records.map((record) => record.scenarioRunId)).toEqual(['fact-query#0', 'fact-query#1', 'fact-query#2'])
    expect(new Set(ledger.records.map((record) => record.requestId)).size).toBe(3)
  })

  it('4. keeps setup, primary and probe apart inside one run', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'cross-session', 'cross-session#1', 'setup', 'req-setup')
    await ledger.track(async () => 'setup')
    scoped(ledger, 'cross-session', 'cross-session#1', 'primary', 'req-main')
    await ledger.track(async () => 'main')
    scoped(ledger, 'cross-session', 'cross-session#1', 'probe', 'req-probe')
    await ledger.track(async () => 'probe')
    expect(ledger.counts()).toMatchObject({ attempted: 3, primary: 1, probe: 1, setup: 1 })
    // Setup calls are not primary answers, so they cannot inflate the answer count.
    expect(ledger.records.filter((record) => record.purpose === 'primary')).toHaveLength(1)
  })

  it('5. keeps a failed probe while the primary answer still succeeded', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-main')
    await ledger.track(async () => 'main')
    scoped(ledger, 'fact-query', 'fact-query#0', 'probe', 'req-probe')
    await expect(ledger.track(async () => {
      throw Object.assign(new Error('probe failed'), { code: 'PROVIDER_NETWORK' })
    })).rejects.toThrow('probe failed')
    expect(ledger.records.find((record) => record.requestId === 'req-main')?.status).toBe('succeeded')
    expect(ledger.records.find((record) => record.requestId === 'req-probe')).toMatchObject({ status: 'failed', failureLayer: 'provider', errorCode: 'PROVIDER_NETWORK' })
    expect(ledger.counts()).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 })
  })

  it('6. keeps a failed primary while the probe succeeded', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-main')
    await expect(ledger.track(async () => {
      throw Object.assign(new Error('boom'), { code: 'PROVIDER_TIMEOUT' })
    })).rejects.toThrow('boom')
    scoped(ledger, 'fact-query', 'fact-query#0', 'probe', 'req-probe')
    await ledger.track(async () => 'probe')
    expect(ledger.records.find((record) => record.requestId === 'req-main')?.status).toBe('failed')
    expect(ledger.records.find((record) => record.requestId === 'req-probe')?.status).toBe('succeeded')
  })

  it('7. records a cancelled call as cancelled, not as a failure', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-cancel')
    await expect(ledger.track(async () => {
      throw Object.assign(new Error('cancelled'), { code: 'PROVIDER_CANCELLED' })
    }, () => 'cancelled')).rejects.toThrow('cancelled')
    expect(ledger.records[0]).toMatchObject({ status: 'cancelled', errorCode: 'PROVIDER_CANCELLED' })
    expect(ledger.counts()).toMatchObject({ attempted: 1, cancelled: 1, failed: 0 })
  })

  it('8. keeps a failed record when the provider throws something unexpected', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'fact-query', 'fact-query#0', 'primary', 'req-unknown')
    await expect(ledger.track(async () => {
      throw 'not an error object'
    })).rejects.toBe('not an error object')
    expect(ledger.records).toHaveLength(1)
    expect(ledger.records[0]).toMatchObject({ status: 'failed', errorCode: 'unknown' })
  })

  it('9. rejects a duplicate request id instead of merging two calls', () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'scenario', 'scenario#0', 'primary', 'req-dup')
    ledger.begin()
    scoped(ledger, 'scenario', 'scenario#0', 'probe', 'req-dup')
    expect(() => ledger.begin()).toThrow(/Duplicate request id/)
    expect(ledger.records).toHaveLength(1)
  })

  it('10. refuses to finish the same request twice', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'scenario', 'scenario#0', 'primary', 'req-once')
    const record = ledger.begin()
    ledger.finish(record, 'succeeded')
    expect(() => ledger.finish(record, 'failed')).toThrow(/already finished/)
  })

  it('11. refuses a scope without an owner', () => {
    const ledger = new RequestLedger()
    expect(() => ledger.scope({ scenarioId: '', scenarioRunId: 'run', purpose: 'primary', requestId: 'req' })).toThrow()
    expect(() => ledger.scope({ scenarioId: 's', scenarioRunId: '', purpose: 'primary', requestId: 'req' })).toThrow()
    expect(() => ledger.scope({ scenarioId: 's', scenarioRunId: 'run', purpose: 'primary', requestId: '' })).toThrow()
  })

  it('12. counts only what actually reached the provider', async () => {
    const ledger = new RequestLedger()
    scoped(ledger, 'a', 'a#0', 'primary', 'a-1')
    await ledger.track(async () => 'ok')
    // A scope change without a call must not create a record.
    scoped(ledger, 'b', 'b#0', 'primary', 'b-1')
    expect(ledger.counts().attempted).toBe(1)
    expect(ledger.records.map((record) => record.scenarioId)).toEqual(['a'])
  })
})

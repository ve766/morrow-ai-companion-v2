import { describe, expect, it } from 'vitest'
import { CONTEXT_UTILITY_WEIGHTS, contextUtility, freshnessOf } from './context-utility'

const base = { relevance: 0.5, freshness: 0.5, quality: 0.5, preference: 0, conflict: 0, stale: 0 }

describe('context utility U(c)', () => {
  it('is monotonic in relevance and bounded by the weight sum', () => {
    const low = contextUtility({ ...base, relevance: 0.2 }).score
    const high = contextUtility({ ...base, relevance: 0.9 }).score
    expect(high).toBeGreaterThan(low)

    const w = CONTEXT_UTILITY_WEIGHTS
    const ceiling = w.relevance + w.freshness + w.quality + w.preference
    const max = contextUtility({ relevance: 1, freshness: 1, quality: 1, preference: 1, conflict: 0, stale: 0 }).score
    const min = contextUtility({ relevance: 0, freshness: 0, quality: 0, preference: 0, conflict: 1, stale: 1 }).score
    expect(max).toBeCloseTo(ceiling, 6)
    expect(min).toBeCloseTo(-(w.conflict + w.stale), 6)
  })

  it('penalizes conflict and staleness instead of ignoring them', () => {
    const clean = contextUtility(base).score
    expect(contextUtility({ ...base, conflict: 1 }).score).toBeLessThan(clean)
    expect(contextUtility({ ...base, stale: 1 }).score).toBeLessThan(clean)
  })

  it('clamps out-of-range and non-finite inputs instead of propagating NaN', () => {
    const result = contextUtility({ relevance: 5, freshness: -3, quality: Number.NaN, preference: 2, conflict: -1, stale: 0.5 })
    expect(result.components.relevance).toBe(1)
    expect(result.components.freshness).toBe(0)
    expect(result.components.quality).toBe(0)
    expect(result.components.preference).toBe(1)
    expect(result.components.conflict).toBe(0)
    expect(Number.isFinite(result.score)).toBe(true)
  })

  it('records a stable reason code for auditing', () => {
    expect(contextUtility({ ...base, relevance: 0.9, quality: 0.9, freshness: 0.9 }).reason).toContain('relevant')
    expect(contextUtility({ ...base, conflict: 1 }).reason).toContain('conflict')
    expect(contextUtility({ relevance: 0, freshness: 0, quality: 0, preference: 0, conflict: 0, stale: 0 }).reason).toContain('low_signal')
  })

  it('halves freshness every 30 days', () => {
    expect(freshnessOf('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBeCloseTo(1, 6)
    expect(freshnessOf('2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z')).toBeCloseTo(0.5, 6)
    expect(freshnessOf('2026-01-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(1)
  })
})

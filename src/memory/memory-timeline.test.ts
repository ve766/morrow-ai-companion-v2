import { describe, expect, it } from 'vitest'
import type { MemoryRevisionRecord } from './memory-domain'
import { buildMemoryTimeline } from './memory-timeline'

function revision(overrides: Partial<MemoryRevisionRecord> & { revision: number }): MemoryRevisionRecord {
  return {
    memoryId: overrides.memoryId ?? '11111111-1111-4111-8111-111111111111',
    revision: overrides.revision,
    content: overrides.content ?? `第 ${overrides.revision} 版内容`,
    sourceCategory: 'user_explicit_input',
    status: overrides.status ?? 'active',
    changeType: overrides.changeType ?? 'created',
    createdAt: overrides.createdAt ?? '2026-10-25T00:00:00.000Z',
    previousRevision: overrides.previousRevision ?? (overrides.revision > 1 ? overrides.revision - 1 : null),
    confidence: overrides.confidence ?? 80
  }
}

describe('memory timeline builder', () => {
  it('orders events by revision, then recorded time, and does not mutate the input', () => {
    const input = [
      revision({ revision: 2, changeType: 'corrected', createdAt: '2026-10-25T02:00:00.000Z' }),
      revision({ revision: 1, changeType: 'created', createdAt: '2026-10-25T01:00:00.000Z' })
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    const timeline = buildMemoryTimeline(input)
    expect(timeline.map((entry) => entry.revision)).toEqual([1, 2])
    expect(input).toEqual(snapshot)
  })

  it('breaks ties deterministically by recorded time and content for equal revisions', () => {
    // Equal revision numbers across DIFFERENT memories (dedup applies within
    // one memory only), so the tiebreak order is what is under test.
    const timeline = buildMemoryTimeline([
      revision({ memoryId: '22222222-2222-4222-8222-222222222222', revision: 1, createdAt: '2026-10-25T03:00:00.000Z', content: 'later' }),
      revision({ memoryId: '33333333-3333-4333-8333-333333333333', revision: 1, createdAt: '2026-10-25T01:00:00.000Z', content: 'earlier' }),
      revision({ memoryId: '44444444-4444-4444-8444-444444444444', revision: 1, createdAt: '2026-10-25T01:00:00.000Z', content: 'aaa' })
    ])
    expect(timeline.map((entry) => entry.content)).toEqual(['aaa', 'earlier', 'later'])
  })

  it('deduplicates entries that describe the same memory revision, keeping the first', () => {
    const timeline = buildMemoryTimeline([
      revision({ revision: 1, content: 'first sight' }),
      revision({ revision: 1, content: 'duplicate from another source' }),
      revision({ revision: 2, changeType: 'corrected' })
    ])
    expect(timeline).toHaveLength(2)
    expect(timeline[0]?.content).toBe('first sight')
    expect(timeline.map((entry) => entry.revision)).toEqual([1, 2])
  })

  it('flags invalid timestamps explicitly instead of rendering them as facts', () => {
    const timeline = buildMemoryTimeline([
      revision({ revision: 1, createdAt: 'not-a-timestamp' }),
      revision({ revision: 2, createdAt: '2026-10-25T02:00:00.000Z' })
    ])
    expect(timeline[0]?.recordedAtValid).toBe(false)
    expect(timeline[0]?.recordedAt).toBe('not-a-timestamp')
    expect(timeline[1]?.recordedAtValid).toBe(true)
    // Invalid timestamps sort after valid ones of the same revision rank.
    const bothInvalid = buildMemoryTimeline([
      revision({ memoryId: '22222222-2222-4222-8222-222222222222', revision: 1, createdAt: 'zzz-invalid' }),
      revision({ memoryId: '33333333-3333-4333-8333-333333333333', revision: 1, createdAt: '2026-10-25T01:00:00.000Z' })
    ])
    expect(bothInvalid.map((entry) => entry.recordedAtValid)).toEqual([true, false])
  })

  it('covers the full lifecycle with stable labels data and keeps source category explicit', () => {
    const timeline = buildMemoryTimeline([
      revision({ revision: 1, changeType: 'created', status: 'active' }),
      revision({ revision: 2, changeType: 'corrected', status: 'active', content: '更正后' }),
      revision({ revision: 3, changeType: 'retracted', status: 'retracted' }),
      revision({ revision: 4, changeType: 'restored', status: 'active', content: '更正后' })
    ])
    expect(timeline.map((entry) => entry.changeType)).toEqual(['created', 'corrected', 'retracted', 'restored'])
    expect(timeline.map((entry) => entry.status)).toEqual(['active', 'active', 'retracted', 'active'])
    expect(timeline.every((entry) => entry.sourceCategory === 'user_explicit_input')).toBe(true)
  })

  it('returns an empty timeline for empty or memoryless input without mutating it', () => {
    expect(buildMemoryTimeline([])).toEqual([])
    const singleton = [revision({ revision: 1 })]
    buildMemoryTimeline(singleton)
    expect(singleton).toHaveLength(1)
  })
})

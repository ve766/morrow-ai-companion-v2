import { describe, expect, it } from 'vitest'
import { isProvablyRecordedAfter, parseStrictIsoTimestamp } from './timestamp-trust'

const BOUNDARY = '2026-10-27T00:00:00.000Z'
const MIGRATION = '2026-10-28T00:00:00.000Z'

describe('strict ISO-8601 parsing', () => {
  it('accepts real instants', () => {
    expect(parseStrictIsoTimestamp('2026-10-27T12:34:56.789Z')).toBe(Date.UTC(2026, 9, 27, 12, 34, 56, 789))
    expect(parseStrictIsoTimestamp('2024-02-29T00:00:00Z')).toBe(Date.UTC(2024, 1, 29))
    expect(parseStrictIsoTimestamp('2026-10-27T00:00:00.5Z')).toBe(Date.UTC(2026, 9, 27, 0, 0, 0, 500))
  })

  it('rejects values whose calendar fields are impossible', () => {
    // These pass a shape check and even a lexicographic comparison.
    expect(parseStrictIsoTimestamp('2026-13-45T00:00:00.000Z')).toBeNull()
    expect(parseStrictIsoTimestamp('2026-02-30T00:00:00.000Z')).toBeNull()
    expect(parseStrictIsoTimestamp('2025-02-29T00:00:00.000Z')).toBeNull()
    expect(parseStrictIsoTimestamp('2026-04-31T00:00:00.000Z')).toBeNull()
    expect(parseStrictIsoTimestamp('2026-10-27T24:00:00.000Z')).toBeNull()
    expect(parseStrictIsoTimestamp('2026-10-27T00:60:00.000Z')).toBeNull()
  })

  it('rejects missing, empty, malformed and non-string values', () => {
    for (const value of [null, undefined, 0, '', 'not-a-date', '2026-10-27', '2026-10-27 00:00:00Z', '2026-10-27T00:00:00+08:00']) {
      expect(parseStrictIsoTimestamp(value), String(value)).toBeNull()
    }
  })
})

describe('provable recording order', () => {
  it('trusts a real instant strictly between the boundary and the migration', () => {
    expect(isProvablyRecordedAfter('2026-10-27T12:00:00.000Z', BOUNDARY, MIGRATION)).toBe(true)
  })

  it('does not trust equality with the boundary', () => {
    expect(isProvablyRecordedAfter(BOUNDARY, BOUNDARY, MIGRATION)).toBe(false)
  })

  it('does not trust a row stamped at or after the migration', () => {
    expect(isProvablyRecordedAfter(MIGRATION, BOUNDARY, MIGRATION)).toBe(false)
    expect(isProvablyRecordedAfter('2099-01-01T00:00:00.000Z', BOUNDARY, MIGRATION)).toBe(false)
    // One millisecond before the migration is still provable.
    expect(isProvablyRecordedAfter('2026-10-27T23:59:59.999Z', BOUNDARY, MIGRATION)).toBe(true)
  })

  it('treats an unknown boundary or migration instant as no proof at all', () => {
    expect(isProvablyRecordedAfter('2026-10-27T12:00:00.000Z', null, MIGRATION)).toBe(false)
    expect(isProvablyRecordedAfter('2026-10-27T12:00:00.000Z', 'not-a-date', MIGRATION)).toBe(false)
    expect(isProvablyRecordedAfter('2026-10-27T12:00:00.000Z', BOUNDARY, '')).toBe(false)
    expect(isProvablyRecordedAfter('', BOUNDARY, MIGRATION)).toBe(false)
  })

  it('does not trust a timestamp before the boundary', () => {
    expect(isProvablyRecordedAfter('2026-10-20T00:00:00.000Z', BOUNDARY, MIGRATION)).toBe(false)
  })
})

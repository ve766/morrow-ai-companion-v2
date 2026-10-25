import { describe, expect, it } from 'vitest'
import {
  defaultReminderSettings,
  isWithinQuietHours,
  localDateTimeToUtc,
  ReminderValidationError,
  systemTimeZone
} from './reminders'

describe('local reminder time and quiet-hour rules', () => {
  it('uses a valid IANA timezone and opts out by default', () => {
    const settings = defaultReminderSettings('Asia/Shanghai', '2026-10-22T02:00:00.000Z')
    expect(settings).toMatchObject({
      enabled: false,
      consentStatus: 'never',
      consentVersion: null,
      maxPer24Hours: 3,
      cooldownMinutes: 120,
      quietHoursEnabled: true,
      timeZone: 'Asia/Shanghai'
    })
    expect(defaultReminderSettings('invalid/timezone', settings.updatedAt).timeZone).toBe('UTC')
    expect(systemTimeZone().length).toBeGreaterThan(0)
  })

  it('converts local wall time to the correct instant in a non-UTC timezone', () => {
    expect(localDateTimeToUtc('2026-10-22T18:30', 'Asia/Shanghai')).toBe('2026-10-22T10:30:00.000Z')
    expect(localDateTimeToUtc('2026-10-22T09:00', 'America/New_York')).toBe('2026-10-22T13:00:00.000Z')
  })

  it('rejects nonexistent daylight-saving local times and deterministically chooses the earlier ambiguous instant', () => {
    expect(() => localDateTimeToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(ReminderValidationError)
    expect(localDateTimeToUtc('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  })

  it('rejects invalid dates, clocks, and timezones', () => {
    for (const value of ['2026-02-30T10:00', '2026-10-22 10:00', '2026-10-22T24:00', '2019-10-22T10:00']) {
      expect(() => localDateTimeToUtc(value, 'Asia/Shanghai')).toThrow(ReminderValidationError)
    }
    expect(() => localDateTimeToUtc('2026-10-22T10:00', 'Mars/Olympus')).toThrow(ReminderValidationError)
  })

  it('handles quiet hours that cross midnight and uses the exclusive end boundary', () => {
    const quietAtNight = new Date('2026-01-01T15:00:00.000Z')
    const quietBeforeMorning = new Date('2026-01-01T23:59:00.000Z')
    const endBoundary = new Date('2026-01-02T00:00:00.000Z')
    const daytime = new Date('2026-01-01T12:00:00.000Z')
    expect(isWithinQuietHours(quietAtNight, 'Asia/Shanghai', '22:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(quietBeforeMorning, 'Asia/Shanghai', '22:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(endBoundary, 'Asia/Shanghai', '22:00', '08:00')).toBe(false)
    expect(isWithinQuietHours(daytime, 'Asia/Shanghai', '22:00', '08:00')).toBe(false)
  })

  it('supports same-day quiet periods and rejects invalid period boundaries', () => {
    expect(isWithinQuietHours(new Date('2026-01-01T12:00:00.000Z'), 'UTC', '12:00', '18:00')).toBe(true)
    expect(isWithinQuietHours(new Date('2026-01-01T18:00:00.000Z'), 'UTC', '12:00', '18:00')).toBe(false)
    expect(() => isWithinQuietHours(new Date(), 'UTC', '08:00', '08:00')).toThrow(ReminderValidationError)
  })
})

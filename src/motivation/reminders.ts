export const REMINDER_KIND = 'goal_review' as const
export const REMINDER_CONSENT_VERSION = 'morrow-local-reminders-1' as const
export const REMINDER_RULE_VERSION = 'goal-review-v1' as const
export const REMINDER_QUEUE_LIMIT = 20
export const REMINDER_MAX_PER_24_HOURS = 3
export const REMINDER_MIN_COOLDOWN_MINUTES = 30
export const REMINDER_MAX_COOLDOWN_MINUTES = 1440
export const REMINDER_HISTORY_RETENTION_DAYS = 30
export const REMINDER_MAX_DECISION_HISTORY = 1000
export const REMINDER_MAX_SCHEDULE_DAYS = 365
export const REMINDER_MAX_DUE_AGE_MS = 24 * 60 * 60 * 1000
export const REMINDER_MAX_DISPATCH_PER_PASS = 10
export const REMINDER_MAX_DISPATCH_TIME_MS = 250
export const REMINDER_NOTIFICATION_TIMEOUT_MS = 5000

export type ReminderConsentStatus = 'never' | 'active' | 'withdrawn'
export type ReminderStatus = 'scheduled' | 'showing' | 'shown' | 'suppressed' | 'cancelled'
export type ReminderDecision = 'scheduled' | 'rescheduled' | 'displaying' | 'triggered' | 'suppressed' | 'cancelled'
export type ReminderDecisionReason =
  | 'user_scheduled'
  | 'user_rescheduled'
  | 'triggered_on_time'
  | 'triggered_after_restart'
  | 'feature_disabled'
  | 'consent_withdrawn'
  | 'paused'
  | 'type_disabled'
  | 'invalid_state'
  | 'goal_inactive'
  | 'goal_deleted'
  | 'quiet_hours'
  | 'daily_limit'
  | 'cooldown'
  | 'muted'
  | 'overdue'
  | 'notification_unsupported'
  | 'notification_failed'
  | 'user_cancelled'
  | 'history_cleared'

export interface ReminderSettings {
  enabled: boolean
  goalReviewEnabled: boolean
  consentStatus: ReminderConsentStatus
  consentVersion: string | null
  consentedAt: string | null
  revokedAt: string | null
  maxPer24Hours: number
  cooldownMinutes: number
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timeZone: string
  mutedUntil: string | null
  updatedAt: string
}

export interface ReminderSettingsRequest {
  enabled: boolean
  goalReviewEnabled: boolean
  acceptConsent: boolean
  maxPer24Hours: number
  cooldownMinutes: number
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timeZone: string
}

export interface ReminderRecord {
  id: string
  goalId: string
  kind: typeof REMINDER_KIND
  status: ReminderStatus
  scheduledAt: string
  scheduledTimeZone: string
  createdAt: string
  updatedAt: string
  shownAt: string | null
  lastDecision: ReminderDecision
  lastReason: ReminderDecisionReason
}

export interface ReminderDecisionRecord {
  id: number
  reminderId: string
  happenedAt: string
  ruleVersion: string
  decision: ReminderDecision
  reason: ReminderDecisionReason
}

export interface ReminderScheduleRequest {
  goalId: string
  localDateTime: string
}

export interface ReminderIdRequest {
  reminderId: string
}

export interface ReminderRescheduleRequest {
  reminderId: string
  localDateTime: string
}

export interface ReminderSnapshot {
  featureEnabled: boolean
  notificationSupported: boolean
  settings: ReminderSettings
  reminders: ReminderRecord[]
  recentDecisions: ReminderDecisionRecord[]
}

export class ReminderValidationError extends Error {
  constructor() {
    super('Reminder request is invalid.')
    this.name = 'ReminderValidationError'
  }
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export function isValidClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)
}

export function defaultReminderSettings(timeZone: string, now: string): ReminderSettings {
  const resolvedZone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  return {
    enabled: false,
    goalReviewEnabled: false,
    consentStatus: 'never',
    consentVersion: null,
    consentedAt: null,
    revokedAt: null,
    maxPer24Hours: REMINDER_MAX_PER_24_HOURS,
    cooldownMinutes: 120,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    timeZone: resolvedZone,
    mutedUntil: null,
    updatedAt: now
  }
}

interface LocalDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function localParts(instant: Date, timeZone: string): LocalDateTimeParts {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = values.find((part) => part.type === type)?.value
    const parsed = raw === undefined ? Number.NaN : Number(raw)
    if (!Number.isInteger(parsed)) throw new ReminderValidationError()
    return parsed
  }
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute')
  }
}

function localMinuteAsUtc(parts: LocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
}

function timeZoneOffsetAt(instantMs: number, timeZone: string): number {
  const roundedInstant = Math.floor(instantMs / 60_000) * 60_000
  return localMinuteAsUtc(localParts(new Date(roundedInstant), timeZone)) - roundedInstant
}

function hasMatchingLocalMinute(instantMs: number, target: LocalDateTimeParts, timeZone: string): boolean {
  const actual = localParts(new Date(instantMs), timeZone)
  return actual.year === target.year && actual.month === target.month && actual.day === target.day &&
    actual.hour === target.hour && actual.minute === target.minute
}

export function localDateTimeToUtc(localDateTime: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone) || typeof localDateTime !== 'string') throw new ReminderValidationError()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(localDateTime)
  if (!match) throw new ReminderValidationError()
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  }
  if (target.year < 2020 || target.month < 1 || target.month > 12 || target.day < 1 || target.day > 31 ||
    target.hour > 23 || target.minute > 59) throw new ReminderValidationError()
  const localAsUtc = localMinuteAsUtc(target)
  const calendarRoundTrip = new Date(localAsUtc)
  if (calendarRoundTrip.getUTCFullYear() !== target.year || calendarRoundTrip.getUTCMonth() + 1 !== target.month ||
    calendarRoundTrip.getUTCDate() !== target.day || calendarRoundTrip.getUTCHours() !== target.hour ||
    calendarRoundTrip.getUTCMinutes() !== target.minute) throw new ReminderValidationError()

  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(timeZoneOffsetAt(localAsUtc + hours * 60 * 60 * 1000, timeZone))
  }
  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((instant) => hasMatchingLocalMinute(instant, target, timeZone))
    .sort((left, right) => left - right)
  if (candidates.length === 0) throw new ReminderValidationError()
  return new Date(candidates[0]!).toISOString()
}

export function isWithinQuietHours(instant: Date, timeZone: string, start: string, end: string): boolean {
  if (!isValidTimeZone(timeZone) || !isValidClockTime(start) || !isValidClockTime(end) || start === end) {
    throw new ReminderValidationError()
  }
  const parts = localParts(instant, timeZone)
  const minuteOfDay = parts.hour * 60 + parts.minute
  const quietStart = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))
  const quietEnd = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5))
  return quietStart < quietEnd
    ? minuteOfDay >= quietStart && minuteOfDay < quietEnd
    : minuteOfDay >= quietStart || minuteOfDay < quietEnd
}

export function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isValidTimeZone(zone) ? zone : 'UTC'
}

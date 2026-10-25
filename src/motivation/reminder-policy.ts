import {
  isValidClockTime,
  isValidTimeZone,
  isWithinQuietHours,
  REMINDER_CONSENT_VERSION,
  REMINDER_MAX_COOLDOWN_MINUTES,
  REMINDER_MAX_DUE_AGE_MS,
  REMINDER_MAX_PER_24_HOURS,
  REMINDER_MIN_COOLDOWN_MINUTES,
  type ReminderDecisionReason,
  type ReminderSettings
} from './reminders'

export type ReminderGoalState = 'active' | 'inactive' | 'missing'
export type ReminderPolicyDisposition = 'notify' | 'suppress' | 'cancel'
export type ReminderPolicySettings = Pick<ReminderSettings,
  | 'enabled'
  | 'goalReviewEnabled'
  | 'consentStatus'
  | 'consentVersion'
  | 'maxPer24Hours'
  | 'cooldownMinutes'
  | 'quietHoursEnabled'
  | 'quietHoursStart'
  | 'quietHoursEnd'
  | 'timeZone'
  | 'mutedUntil'
>

export interface ReminderPolicyInput {
  now: string
  scheduledAt: string
  replayed: boolean
  featureEnabled: boolean
  notificationSupported: boolean
  goalState: ReminderGoalState
  shownInLast24Hours: number
  lastShownAt: string | null
  settings: ReminderPolicySettings
}

export interface ReminderPolicyDecision {
  disposition: ReminderPolicyDisposition
  reason: ReminderDecisionReason
}

function decision(disposition: ReminderPolicyDisposition, reason: ReminderDecisionReason): ReminderPolicyDecision {
  return { disposition, reason }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const instant = Date.parse(value)
  return Number.isFinite(instant) && new Date(instant).toISOString() === value
}

export function decideGoalReviewReminder(input: ReminderPolicyInput): ReminderPolicyDecision {
  const now = Date.parse(input.now)
  const scheduledAt = Date.parse(input.scheduledAt)
  const settings = input.settings
  if (!isCanonicalTimestamp(input.now) || !isCanonicalTimestamp(input.scheduledAt) || typeof input.replayed !== 'boolean' ||
    typeof input.featureEnabled !== 'boolean' || typeof input.notificationSupported !== 'boolean' ||
    !Number.isSafeInteger(input.shownInLast24Hours) || input.shownInLast24Hours < 0 ||
    typeof settings.enabled !== 'boolean' || typeof settings.goalReviewEnabled !== 'boolean' ||
    typeof settings.quietHoursEnabled !== 'boolean' || !isValidClockTime(settings.quietHoursStart) ||
    !isValidClockTime(settings.quietHoursEnd) || !isValidTimeZone(settings.timeZone) ||
    !Number.isSafeInteger(settings.maxPer24Hours) || settings.maxPer24Hours < 1 ||
    settings.maxPer24Hours > REMINDER_MAX_PER_24_HOURS || !Number.isSafeInteger(settings.cooldownMinutes) ||
    settings.cooldownMinutes < REMINDER_MIN_COOLDOWN_MINUTES || settings.cooldownMinutes > REMINDER_MAX_COOLDOWN_MINUTES ||
    (settings.quietHoursEnabled && settings.quietHoursStart === settings.quietHoursEnd)) {
    return decision('suppress', 'invalid_state')
  }

  if (!input.featureEnabled) return decision('cancel', 'feature_disabled')
  if (!settings.enabled || settings.consentStatus !== 'active' || settings.consentVersion !== REMINDER_CONSENT_VERSION) {
    return decision('cancel', settings.consentStatus === 'withdrawn' ? 'consent_withdrawn' : 'paused')
  }
  if (!settings.goalReviewEnabled) return decision('cancel', 'type_disabled')
  if (input.goalState === 'missing') return decision('cancel', 'goal_deleted')
  if (input.goalState === 'inactive') return decision('cancel', 'goal_inactive')
  if (input.goalState !== 'active' || scheduledAt > now) return decision('suppress', 'invalid_state')

  const dueAge = now - scheduledAt
  if (dueAge > REMINDER_MAX_DUE_AGE_MS) return decision('suppress', 'overdue')

  if (settings.mutedUntil !== null) {
    if (!isCanonicalTimestamp(settings.mutedUntil)) return decision('suppress', 'invalid_state')
    const mutedUntil = Date.parse(settings.mutedUntil)
    if (mutedUntil > now) return decision('suppress', 'muted')
  }

  if (settings.quietHoursEnabled) {
    try {
      if (isWithinQuietHours(new Date(now), settings.timeZone, settings.quietHoursStart, settings.quietHoursEnd)) {
        return decision('suppress', 'quiet_hours')
      }
    } catch {
      return decision('suppress', 'invalid_state')
    }
  }

  if (input.shownInLast24Hours >= settings.maxPer24Hours) return decision('suppress', 'daily_limit')
  if (input.lastShownAt !== null) {
    if (!isCanonicalTimestamp(input.lastShownAt)) return decision('suppress', 'invalid_state')
    const lastShownAt = Date.parse(input.lastShownAt)
    if (lastShownAt > now) return decision('suppress', 'invalid_state')
    if (now - lastShownAt < settings.cooldownMinutes * 60_000) return decision('suppress', 'cooldown')
  }
  if (!input.notificationSupported) return decision('suppress', 'notification_unsupported')

  return decision('notify', input.replayed ? 'triggered_after_restart' : 'triggered_on_time')
}

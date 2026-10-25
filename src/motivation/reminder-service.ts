import { randomUUID } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import type { GoalStore } from './goal-store'
import type { ReminderDecisionDraft, ReminderStore } from './reminder-store'
import {
  defaultReminderSettings,
  isValidClockTime,
  isValidTimeZone,
  localDateTimeToUtc,
  REMINDER_CONSENT_VERSION,
  REMINDER_HISTORY_RETENTION_DAYS,
  REMINDER_KIND,
  REMINDER_MAX_DISPATCH_PER_PASS,
  REMINDER_MAX_DISPATCH_TIME_MS,
  REMINDER_MAX_PER_24_HOURS,
  REMINDER_MAX_SCHEDULE_DAYS,
  REMINDER_MIN_COOLDOWN_MINUTES,
  REMINDER_MAX_COOLDOWN_MINUTES,
  REMINDER_NOTIFICATION_TIMEOUT_MS,
  REMINDER_QUEUE_LIMIT,
  REMINDER_RULE_VERSION,
  ReminderValidationError,
  systemTimeZone,
  type ReminderDecisionReason,
  type ReminderRecord,
  type ReminderRescheduleRequest,
  type ReminderScheduleRequest,
  type ReminderSettings,
  type ReminderSettingsRequest,
  type ReminderSnapshot,
  type ReminderStatus
} from './reminders'
import { decideGoalReviewReminder } from './reminder-policy'

export interface ReminderNotificationCallbacks {
  onShown(): void
  onFailed(): void
  onClick(): void
  onClosed(): void
}

export interface ReminderNotificationHandle {
  close(): void
}

export interface ReminderNotificationPort {
  isSupported(): boolean
  show(callbacks: ReminderNotificationCallbacks): ReminderNotificationHandle
}

export interface ReminderServiceOptions {
  featureEnabled: boolean
  timeZone?: () => string
  now?: () => Date
  monotonicNow?: () => number
  makeId?: () => string
  notifyUser?: () => void
  notifyChanged?: () => void
}

export interface ReminderActions {
  snapshot(): ReminderSnapshot
  saveSettings(request: ReminderSettingsRequest): ReminderSnapshot
  pause(): ReminderSnapshot
  withdrawConsent(): ReminderSnapshot
  muteForOneHour(): ReminderSnapshot
  unmute(): ReminderSnapshot
  schedule(request: ReminderScheduleRequest): ReminderRecord
  reschedule(request: ReminderRescheduleRequest): ReminderRecord
  cancel(reminderId: string): ReminderRecord
  cancelForGoal(goalId: string, reason: 'goal_inactive' | 'goal_deleted'): void
  clearHistory(): ReminderSnapshot
}

const MAX_VISIBLE_RECORDS = 50
const MAX_VISIBLE_DECISIONS = 100
const MINIMUM_SCHEDULE_AHEAD_MS = 30_000
const MAX_TIMER_DELAY_MS = 2_147_000_000
const DAY_MS = 24 * 60 * 60 * 1000

export class ReminderService implements ReminderActions {
  private readonly featureEnabled: boolean
  private readonly timeZone: () => string
  private readonly now: () => Date
  private readonly monotonicNow: () => number
  private readonly makeId: () => string
  private readonly notifyUser: () => void
  private readonly notifyChanged: () => void
  private readonly handles = new Map<string, { goalId: string; handle: ReminderNotificationHandle }>()
  private readonly notificationTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false
  private startupReplay = false

  constructor(
    private readonly store: ReminderStore,
    private readonly goals: GoalStore,
    private readonly notifications: ReminderNotificationPort,
    options: ReminderServiceOptions
  ) {
    this.featureEnabled = options.featureEnabled
    this.timeZone = options.timeZone ?? systemTimeZone
    this.now = options.now ?? (() => new Date())
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.makeId = options.makeId ?? randomUUID
    this.notifyUser = options.notifyUser ?? (() => undefined)
    this.notifyChanged = options.notifyChanged ?? (() => undefined)
  }

  snapshot(): ReminderSnapshot {
    const now = this.now()
    this.prune(now)
    return {
      featureEnabled: this.featureEnabled,
      notificationSupported: this.notifications.isSupported(),
      settings: this.settings(now),
      reminders: this.store.listReminders(MAX_VISIBLE_RECORDS),
      recentDecisions: this.store.listRecentDecisions(MAX_VISIBLE_DECISIONS)
    }
  }

  saveSettings(request: ReminderSettingsRequest): ReminderSnapshot {
    const now = this.now()
    this.validateSettings(request)
    if (request.enabled && !this.featureEnabled) throw new ApplicationError('FORBIDDEN')
    if (request.enabled && !this.notifications.isSupported()) throw new ApplicationError('FORBIDDEN')

    const current = this.settings(now)
    const grantingConsent = request.enabled && (
      current.consentStatus !== 'active' || current.consentVersion !== REMINDER_CONSENT_VERSION
    )
    if (grantingConsent && !request.acceptConsent) throw new ReminderValidationError()
    const updated: ReminderSettings = {
      ...current,
      enabled: request.enabled,
      goalReviewEnabled: request.goalReviewEnabled,
      consentStatus: grantingConsent ? 'active' : current.consentStatus,
      consentVersion: grantingConsent ? REMINDER_CONSENT_VERSION : current.consentVersion,
      consentedAt: grantingConsent ? now.toISOString() : current.consentedAt,
      revokedAt: grantingConsent ? null : current.revokedAt,
      maxPer24Hours: request.maxPer24Hours,
      cooldownMinutes: request.cooldownMinutes,
      quietHoursEnabled: request.quietHoursEnabled,
      quietHoursStart: request.quietHoursStart,
      quietHoursEnd: request.quietHoursEnd,
      timeZone: request.timeZone,
      updatedAt: now.toISOString()
    }
    this.store.saveSettings(updated)
    if (!request.enabled) {
      this.cancelPending(current.consentStatus === 'withdrawn' ? 'consent_withdrawn' : 'paused', now)
      this.closeAllNotifications()
    } else if (current.goalReviewEnabled && !request.goalReviewEnabled) {
      this.cancelPending('type_disabled', now)
      this.closeAllNotifications()
    }
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  pause(): ReminderSnapshot {
    const now = this.now()
    const current = this.settings(now)
    this.store.saveSettings({ ...current, enabled: false, updatedAt: now.toISOString() })
    this.cancelPending('paused', now)
    this.closeAllNotifications()
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  withdrawConsent(): ReminderSnapshot {
    const now = this.now()
    const current = this.settings(now)
    if (current.consentStatus === 'never') return this.pause()
    const updated: ReminderSettings = {
      ...current,
      enabled: false,
      goalReviewEnabled: false,
      consentStatus: 'withdrawn',
      revokedAt: current.consentStatus === 'withdrawn' ? current.revokedAt : now.toISOString(),
      mutedUntil: null,
      updatedAt: now.toISOString()
    }
    this.store.saveSettings(updated)
    this.cancelPending('consent_withdrawn', now)
    this.closeAllNotifications()
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  muteForOneHour(): ReminderSnapshot {
    const now = this.now()
    const current = this.settings(now)
    if (!current.enabled || current.consentStatus !== 'active') throw new ApplicationError('CONFLICT')
    this.store.saveSettings({
      ...current,
      mutedUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      updatedAt: now.toISOString()
    })
    this.closeForMute(now)
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  unmute(): ReminderSnapshot {
    const now = this.now()
    const current = this.settings(now)
    this.store.saveSettings({ ...current, mutedUntil: null, updatedAt: now.toISOString() })
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  schedule(request: ReminderScheduleRequest): ReminderRecord {
    const now = this.now()
    const settings = this.settings(now)
    this.assertCanSchedule(settings, request.goalId, false, now)
    const scheduledAt = this.validateScheduleTime(request.localDateTime, settings.timeZone, now)
    const id = this.makeId()
    const reminder: ReminderRecord = {
      id,
      goalId: request.goalId,
      kind: REMINDER_KIND,
      status: 'scheduled',
      scheduledAt,
      scheduledTimeZone: settings.timeZone,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      shownAt: null,
      lastDecision: 'scheduled',
      lastReason: 'user_scheduled'
    }
    this.store.createReminder(reminder, this.decision(id, now, 'scheduled', 'user_scheduled'))
    this.prune(now)
    this.notifyChanged()
    this.armTimer()
    return reminder
  }

  reschedule(request: ReminderRescheduleRequest): ReminderRecord {
    const now = this.now()
    const current = this.store.getReminder(request.reminderId)
    if (!current) throw new ApplicationError('NOT_FOUND')
    if (!(['scheduled', 'suppressed', 'cancelled'] as ReminderStatus[]).includes(current.status)) {
      throw new ApplicationError('CONFLICT')
    }
    const settings = this.settings(now)
    this.assertCanSchedule(settings, current.goalId, current.status === 'scheduled', now)
    const scheduledAt = this.validateScheduleTime(request.localDateTime, settings.timeZone, now)
    const updated: ReminderRecord = {
      ...current,
      status: 'scheduled',
      scheduledAt,
      scheduledTimeZone: settings.timeZone,
      updatedAt: now.toISOString(),
      shownAt: null,
      lastDecision: 'rescheduled',
      lastReason: 'user_rescheduled'
    }
    const result = this.store.reschedule(updated, this.decision(current.id, now, 'rescheduled', 'user_rescheduled'))
    if (!result) throw new ApplicationError('CONFLICT')
    this.prune(now)
    this.notifyChanged()
    this.armTimer()
    return result
  }

  cancel(reminderId: string): ReminderRecord {
    const now = this.now()
    const updated = this.store.updateStatus(
      reminderId, ['scheduled', 'showing'], 'cancelled', 'cancelled', 'user_cancelled', now.toISOString()
    )
    if (!updated) throw new ApplicationError('CONFLICT')
    this.closeNotification(reminderId)
    this.prune(now)
    this.notifyChanged()
    this.armTimer()
    return updated
  }

  cancelForGoal(goalId: string, reason: 'goal_inactive' | 'goal_deleted'): void {
    const now = this.now()
    this.cancelPending(reason, now, goalId)
    for (const [id, active] of [...this.handles]) {
      if (active.goalId !== goalId) continue
      this.closeNotification(id)
    }
    this.notifyChanged()
    this.armTimer()
  }

  clearHistory(): ReminderSnapshot {
    this.closeIds(this.store.clearHistory())
    this.notifyChanged()
    this.armTimer()
    return this.snapshot()
  }

  startScheduler(): void {
    if (this.started) return
    this.started = true
    const now = this.now()
    this.store.recoverShowing(now.toISOString())
    this.prune(now)
    const settings = this.settings(now)
    if (!this.featureEnabled) {
      if (settings.enabled) this.store.saveSettings({ ...settings, enabled: false, updatedAt: now.toISOString() })
      this.cancelPending('feature_disabled', now)
      this.closeAllNotifications()
      return
    }
    if (!settings.enabled || settings.consentStatus !== 'active' || settings.consentVersion !== REMINDER_CONSENT_VERSION) {
      if (settings.enabled) this.store.saveSettings({ ...settings, enabled: false, updatedAt: now.toISOString() })
      this.cancelPending(settings.consentStatus === 'withdrawn' ? 'consent_withdrawn' : 'paused', now)
      this.closeAllNotifications()
      return
    }
    if (!settings.goalReviewEnabled) {
      this.cancelPending('type_disabled', now)
      this.closeAllNotifications()
      return
    }
    const startupNow = now.toISOString()
    for (const reminder of this.store.pendingReminders()) {
      const goal = this.goals.getGoal(reminder.goalId)
      if (!goal || goal.status !== 'active') {
        const reason: ReminderDecisionReason = goal ? 'goal_inactive' : 'goal_deleted'
        this.transition(reminder.id, 'cancelled', 'scheduled', reason, startupNow)
      }
    }
    this.startupReplay = true
    this.dispatchDue()
    this.startupReplay = false
    this.armTimer()
  }

  shutdown(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const timeout of this.notificationTimeouts.values()) clearTimeout(timeout)
    this.notificationTimeouts.clear()
    this.closeAllNotifications()
  }

  dispatchDue(): void {
    if (!this.started || !this.featureEnabled) return
    const startedAt = this.monotonicNow()
    const now = this.now()
    const nowIso = now.toISOString()
    const due = this.store.dueReminders(nowIso, REMINDER_QUEUE_LIMIT)
    let processed = 0
    for (const reminder of due) {
      if (processed >= REMINDER_MAX_DISPATCH_PER_PASS || this.monotonicNow() - startedAt >= REMINDER_MAX_DISPATCH_TIME_MS) break
      processed += 1
      this.dispatchOne(reminder, now)
    }
    this.armTimer()
  }

  private dispatchOne(reminder: ReminderRecord, now: Date): void {
    const settings = this.settings(now)
    const nowIso = now.toISOString()
    const goal = this.goals.getGoal(reminder.goalId)
    const replayed = this.startupReplay && Date.parse(reminder.scheduledAt) < now.getTime()
    const policy = decideGoalReviewReminder({
      now: nowIso,
      scheduledAt: reminder.scheduledAt,
      replayed,
      featureEnabled: this.featureEnabled,
      notificationSupported: this.notifications.isSupported(),
      goalState: !goal ? 'missing' : goal.status === 'active' ? 'active' : 'inactive',
      shownInLast24Hours: this.store.countShownSince(new Date(now.getTime() - DAY_MS).toISOString()),
      lastShownAt: this.store.lastShownAt(),
      settings
    })
    if (policy.disposition !== 'notify') {
      const status: ReminderStatus = policy.disposition === 'cancel' ? 'cancelled' : 'suppressed'
      this.transition(reminder.id, status, 'scheduled', policy.reason, nowIso)
      return
    }
    const reason = policy.reason
    const showing = this.transition(reminder.id, 'showing', 'scheduled', reason, nowIso)
    if (!showing) return

    try {
      const handle = this.notifications.show({
        onShown: () => this.notificationShown(reminder.id, replayed),
        onFailed: () => this.notificationFailed(reminder.id),
        onClick: () => {
          if (this.started) this.notifyUser()
        },
        onClosed: () => this.notificationClosed(reminder.id)
      })
      const current = this.store.getReminder(reminder.id)
      if (!this.started || !current || !['showing', 'shown'].includes(current.status)) {
        try {
          handle.close()
        } catch {
          return
        }
      } else {
        this.handles.set(reminder.id, { goalId: reminder.goalId, handle })
        if (current.status === 'showing') {
          const timeout = setTimeout(() => this.notificationFailed(reminder.id), REMINDER_NOTIFICATION_TIMEOUT_MS)
          this.notificationTimeouts.set(reminder.id, timeout)
          if (typeof timeout === 'object' && 'unref' in timeout) timeout.unref()
        }
      }
    } catch {
      this.notificationFailed(reminder.id)
    }
  }

  private notificationShown(reminderId: string, replayed: boolean): void {
    this.clearNotificationTimeout(reminderId)
    if (!this.started) return
    const now = this.now().toISOString()
    const reason: ReminderDecisionReason = replayed ? 'triggered_after_restart' : 'triggered_on_time'
    if (this.store.updateStatus(reminderId, ['showing'], 'shown', 'triggered', reason, now, now)) this.notifyChanged()
    this.armTimer()
  }

  private notificationFailed(reminderId: string): void {
    this.clearNotificationTimeout(reminderId)
    if (!this.started) {
      this.handles.delete(reminderId)
      return
    }
    this.closeNotification(reminderId)
    this.transition(reminderId, 'suppressed', 'showing', 'notification_failed', this.now().toISOString())
    this.armTimer()
  }

  private notificationClosed(reminderId: string): void {
    this.clearNotificationTimeout(reminderId)
    this.handles.delete(reminderId)
    if (!this.started) return
    this.transition(reminderId, 'suppressed', 'showing', 'notification_failed', this.now().toISOString())
  }

  private transition(
    reminderId: string,
    status: ReminderStatus,
    from: ReminderStatus,
    reason: ReminderDecisionReason,
    now: string
  ): ReminderRecord | null {
    const decision: ReminderRecord['lastDecision'] = status === 'showing'
      ? 'displaying'
      : status === 'cancelled' ? 'cancelled' : 'suppressed'
    const updated = this.store.updateStatus(reminderId, [from], status, decision, reason, now)
    if (updated) {
      this.prune(new Date(now))
      this.notifyChanged()
    }
    return updated
  }

  private assertCanSchedule(settings: ReminderSettings, goalId: string, alreadyPending: boolean, now: Date): void {
    if (!this.featureEnabled || !settings.enabled || !settings.goalReviewEnabled ||
      settings.consentStatus !== 'active' || settings.consentVersion !== REMINDER_CONSENT_VERSION ||
      !this.notifications.isSupported()) {
      throw new ApplicationError('FORBIDDEN')
    }
    const goal = this.goals.getGoal(goalId)
    if (!goal || goal.status !== 'active') throw new ApplicationError('CONFLICT')
    if (this.store.pendingCount() >= REMINDER_QUEUE_LIMIT && !alreadyPending) throw new ApplicationError('CONFLICT')
    if (!isValidTimeZone(settings.timeZone)) throw new ReminderValidationError()
    if (now.getTime() < 0) throw new ReminderValidationError()
  }

  private validateScheduleTime(localDateTime: string, timeZone: string, now: Date): string {
    const scheduledAt = localDateTimeToUtc(localDateTime, timeZone)
    const scheduledMs = Date.parse(scheduledAt)
    if (!Number.isFinite(scheduledMs) || scheduledMs < now.getTime() + MINIMUM_SCHEDULE_AHEAD_MS ||
      scheduledMs > now.getTime() + REMINDER_MAX_SCHEDULE_DAYS * DAY_MS) throw new ReminderValidationError()
    return scheduledAt
  }

  private validateSettings(request: ReminderSettingsRequest): void {
    if (typeof request.enabled !== 'boolean' || typeof request.goalReviewEnabled !== 'boolean' ||
      typeof request.acceptConsent !== 'boolean' || typeof request.quietHoursEnabled !== 'boolean' ||
      !Number.isInteger(request.maxPer24Hours) || request.maxPer24Hours < 1 ||
      request.maxPer24Hours > REMINDER_MAX_PER_24_HOURS || !Number.isInteger(request.cooldownMinutes) ||
      request.cooldownMinutes < REMINDER_MIN_COOLDOWN_MINUTES || request.cooldownMinutes > REMINDER_MAX_COOLDOWN_MINUTES ||
      !isValidClockTime(request.quietHoursStart) || !isValidClockTime(request.quietHoursEnd) ||
      (request.quietHoursEnabled && request.quietHoursStart === request.quietHoursEnd) ||
      !isValidTimeZone(request.timeZone)) throw new ReminderValidationError()
  }

  private settings(now: Date): ReminderSettings {
    return this.store.getSettings(this.timeZone(), now.toISOString())
  }

  private decision(
    reminderId: string,
    now: Date,
    decision: ReminderDecisionDraft['decision'],
    reason: ReminderDecisionReason
  ): ReminderDecisionDraft {
    return { reminderId, happenedAt: now.toISOString(), ruleVersion: REMINDER_RULE_VERSION, decision, reason }
  }

  private cancelPending(reason: ReminderDecisionReason, now: Date, goalId?: string): void {
    const ids = this.store.cancelPending(reason, now.toISOString(), goalId)
    this.closeIds(ids)
    if (ids.length > 0) this.prune(now)
  }

  private closeForMute(now: Date): void {
    let closed = false
    for (const id of [...this.handles.keys()]) {
      this.transition(id, 'suppressed', 'showing', 'muted', now.toISOString())
      this.closeNotification(id)
      closed = true
    }
    if (closed) this.notifyChanged()
  }

  private prune(now: Date): void {
    this.store.pruneHistory(new Date(now.getTime() - REMINDER_HISTORY_RETENTION_DAYS * DAY_MS).toISOString())
  }

  private closeIds(ids: readonly string[]): void {
    for (const id of ids) this.closeNotification(id)
  }

  private closeAllNotifications(): void {
    for (const id of [...this.handles.keys()]) this.closeNotification(id)
  }

  private closeNotification(id: string): void {
    const timeout = this.notificationTimeouts.get(id)
    if (timeout) clearTimeout(timeout)
    this.notificationTimeouts.delete(id)
    const active = this.handles.get(id)
    this.handles.delete(id)
    if (active) {
      try {
        active.handle.close()
      } catch {
        return
      }
    }
  }

  private clearNotificationTimeout(id: string): void {
    const timeout = this.notificationTimeouts.get(id)
    if (timeout) clearTimeout(timeout)
    this.notificationTimeouts.delete(id)
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.started || !this.featureEnabled) return
    const settings = this.settings(this.now())
    if (!settings.enabled || !settings.goalReviewEnabled || settings.consentStatus !== 'active' ||
      settings.consentVersion !== REMINDER_CONSENT_VERSION) return
    const next = this.store.nextScheduledAt()
    if (!next) return
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, Date.parse(next) - this.now().getTime()))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.dispatchDue()
    }, delay)
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref()
  }
}

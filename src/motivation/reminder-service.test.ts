import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GoalCreateRequest } from '../shared/contracts'
import { GOAL_DEFAULT_CONSTRAINTS, GOAL_SUCCESS_CRITERION, SUPPORTED_GOAL_INTENT } from './goals'
import { ReminderService, type ReminderNotificationCallbacks, type ReminderNotificationPort } from './reminder-service'
import { ApplicationError } from '../shared/errors'
import { GoalService } from './goal-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteGoalRepository } from '../persistence/goal-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { SqliteReminderRepository } from '../persistence/reminder-repository'
import type { ReminderSettingsRequest } from './reminders'
import { ReminderValidationError } from './reminders'

const initialInstant = '2026-10-22T02:00:00.000Z'
const goalRequest: GoalCreateRequest = {
  intent: SUPPORTED_GOAL_INTENT,
  successCriterion: GOAL_SUCCESS_CRITERION,
  constraints: GOAL_DEFAULT_CONSTRAINTS,
  acceptedBoundary: true
}

class FakeNotifications implements ReminderNotificationPort {
  supported = true
  deliveries: Array<{ callbacks: ReminderNotificationCallbacks; close: ReturnType<typeof vi.fn> }> = []

  isSupported(): boolean {
    return this.supported
  }

  show(callbacks: ReminderNotificationCallbacks) {
    const close = vi.fn()
    this.deliveries.push({ callbacks, close })
    return { close }
  }
}

function createHarness(options: {
  featureEnabled?: boolean
  notificationSupported?: boolean
  databasePath?: string
  monotonicNow?: () => number
  notifyChanged?: () => void
} = {}) {
  const database = SqliteDatabase.open(options.databasePath ?? ':memory:')
  const goalRepository = new SqliteGoalRepository(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), () => initialInstant, () => randomUUID())
  const notifications = new FakeNotifications()
  notifications.supported = options.notificationSupported ?? true
  let currentInstant = new Date(initialInstant)
  let monotonic = 0
  const reminders = new ReminderService(
    new SqliteReminderRepository(database),
    goalRepository,
    notifications,
    {
      featureEnabled: options.featureEnabled ?? true,
      timeZone: () => 'Asia/Shanghai',
      now: () => new Date(currentInstant),
      monotonicNow: options.monotonicNow ?? (() => ++monotonic),
      makeId: () => randomUUID(),
      notifyChanged: options.notifyChanged ?? (() => undefined)
    }
  )
  const goals = new GoalService(goalRepository, memories, {
    clock: () => currentInstant.toISOString(),
    makeId: () => randomUUID(),
    reminderLifecycle: reminders
  })
  const goal = goals.create(goalRequest)
  return {
    database,
    goal,
    goals,
    memories,
    notifications,
    reminders,
    setNow: (value: string) => { currentInstant = new Date(value) },
    close: () => {
      reminders.shutdown()
      database.close()
    }
  }
}

function settings(overrides: Partial<ReminderSettingsRequest> = {}): ReminderSettingsRequest {
  return {
    enabled: true,
    goalReviewEnabled: true,
    acceptConsent: true,
    maxPer24Hours: 3,
    cooldownMinutes: 30,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    timeZone: 'Asia/Shanghai',
    ...overrides
  }
}

function enable(reminders: ReminderService, overrides: Partial<ReminderSettingsRequest> = {}) {
  return reminders.saveSettings(settings(overrides))
}

function expectApplicationError(action: () => unknown, code: 'FORBIDDEN' | 'CONFLICT'): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ApplicationError)
  expect(caught).toMatchObject({ code })
}

describe('M4 local, consented and bounded goal reminders', () => {
  it('keeps the release flag and user consent off by default', () => {
    const disabled = createHarness({ featureEnabled: false })
    try {
      expect(disabled.reminders.snapshot()).toMatchObject({
        featureEnabled: false,
        settings: { enabled: false, consentStatus: 'never', consentedAt: null }
      })
      expectApplicationError(() => enable(disabled.reminders), 'FORBIDDEN')
    } finally {
      disabled.close()
    }

    const noConsent = createHarness()
    try {
      expect(() => enable(noConsent.reminders, { acceptConsent: false })).toThrow(ReminderValidationError)
      expect(noConsent.reminders.snapshot().settings.consentStatus).toBe('never')
    } finally {
      noConsent.close()
    }
  })

  it('does not enable reminders when desktop notifications are unavailable', () => {
    const harness = createHarness({ notificationSupported: false })
    try {
      expectApplicationError(() => enable(harness.reminders), 'FORBIDDEN')
      expect(harness.reminders.snapshot().settings.enabled).toBe(false)
      expect(harness.reminders.snapshot().notificationSupported).toBe(false)
    } finally {
      harness.close()
    }
  })

  it('requires an active goal, supported notifications, valid local time, and an explicit active consent', () => {
    const harness = createHarness()
    try {
      expectApplicationError(
        () => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' }),
        'FORBIDDEN'
      )
      enable(harness.reminders)
      expectApplicationError(
        () => harness.reminders.schedule({ goalId: randomUUID(), localDateTime: '2026-10-22T10:01' }),
        'CONFLICT'
      )
      expect(() => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:00' }))
        .toThrow(ReminderValidationError)
      expect(() => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' }))
        .not.toThrow()
      expect(harness.reminders.snapshot().reminders).toHaveLength(1)
    } finally {
      harness.close()
    }
  })

  it('enforces the pending queue limit and permits rescheduling a cancelled reminder', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const first = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      expect(harness.reminders.cancel(first.id).status).toBe('cancelled')
      const rescheduled = harness.reminders.reschedule({ reminderId: first.id, localDateTime: '2026-10-22T11:00' })
      expect(rescheduled).toMatchObject({
        id: first.id,
        status: 'scheduled',
        scheduledAt: '2026-10-22T03:00:00.000Z',
        scheduledTimeZone: 'Asia/Shanghai',
        lastDecision: 'rescheduled',
        lastReason: 'user_rescheduled'
      })
      const times = ['11:01', '11:02', '11:03', '11:04', '11:05', '11:06', '11:07', '11:08', '11:09', '11:10', '11:11', '11:12', '11:13', '11:14', '11:15', '11:16', '11:17', '11:18', '11:19']
      for (const time of times) harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: `2026-10-22T${time}` })
      expectApplicationError(
        () => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T11:20' }),
        'CONFLICT'
      )
    } finally {
      harness.close()
    }
  })

  it('pauses pending reminders, closes visible notices, and permanently records consent withdrawal', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const pending = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      const paused = harness.reminders.pause()
      expect(paused.settings).toMatchObject({ enabled: false, consentStatus: 'active' })
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === pending.id))
        .toMatchObject({ status: 'cancelled', lastReason: 'paused' })
      expectApplicationError(
        () => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:02' }),
        'FORBIDDEN'
      )

      enable(harness.reminders, { acceptConsent: false })
      const visible = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:03' })
      harness.setNow('2026-10-22T02:04:00.000Z')
      harness.reminders.startScheduler()
      const delivery = harness.notifications.deliveries[0]!
      delivery.callbacks.onShown()
      harness.reminders.withdrawConsent()
      expect(delivery.close).toHaveBeenCalledOnce()
      expect(harness.reminders.snapshot().settings).toMatchObject({
        enabled: false,
        goalReviewEnabled: false,
        consentStatus: 'withdrawn',
        revokedAt: '2026-10-22T02:04:00.000Z',
        mutedUntil: null
      })
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === visible.id))
        .toMatchObject({ status: 'shown', lastReason: 'triggered_after_restart' })
    } finally {
      harness.close()
    }
  })

  it('uses a cooldown reservation while a notification is showing, even before its show event arrives', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const first = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      const second = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:02' })
      harness.setNow('2026-10-22T02:03:00.000Z')
      harness.reminders.startScheduler()
      expect(harness.notifications.deliveries).toHaveLength(1)
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === first.id))
        .toMatchObject({ status: 'showing', lastDecision: 'displaying' })
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === second.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'cooldown' })
      harness.notifications.deliveries[0]!.callbacks.onShown()
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === first.id))
        .toMatchObject({ status: 'shown', lastDecision: 'triggered' })
    } finally {
      harness.close()
    }
  })

  it('enforces rolling 24-hour limits across separate dispatch passes', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders, { maxPer24Hours: 3, cooldownMinutes: 30 })
      const times = ['10:01', '10:32', '11:03', '11:34']
      const reminders = times.map((time) => harness.reminders.schedule({
        goalId: harness.goal.id,
        localDateTime: `2026-10-22T${time}`
      }))
      harness.reminders.startScheduler()
      for (let index = 0; index < times.length; index += 1) {
        const [hourText, minuteText] = times[index]!.split(':')
        const hour = Number(hourText)
        const minute = Number(minuteText)
        const localAsUtc = Date.UTC(2026, 9, 22, hour, minute + 1) - 8 * 60 * 60 * 1000
        harness.setNow(new Date(localAsUtc).toISOString())
        harness.reminders.dispatchDue()
        const delivery = harness.notifications.deliveries[index]
        if (delivery) delivery.callbacks.onShown()
      }
      expect(harness.notifications.deliveries).toHaveLength(3)
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === reminders[3]!.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'daily_limit' })
    } finally {
      harness.close()
    }
  })

  it('suppresses muted, quiet-hour, and stale startup reminders without showing them', () => {
    const muted = createHarness()
    try {
      enable(muted.reminders)
      const reminder = muted.reminders.schedule({ goalId: muted.goal.id, localDateTime: '2026-10-22T10:01' })
      muted.reminders.muteForOneHour()
      muted.setNow('2026-10-22T02:02:00.000Z')
      muted.reminders.startScheduler()
      expect(muted.notifications.deliveries).toHaveLength(0)
      expect(muted.reminders.snapshot().reminders.find((item) => item.id === reminder.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'muted' })
    } finally {
      muted.close()
    }

    const quiet = createHarness()
    try {
      enable(quiet.reminders, { quietHoursEnabled: true })
      const reminder = quiet.reminders.schedule({ goalId: quiet.goal.id, localDateTime: '2026-10-22T22:30' })
      quiet.setNow('2026-10-22T14:31:00.000Z')
      quiet.reminders.startScheduler()
      expect(quiet.notifications.deliveries).toHaveLength(0)
      expect(quiet.reminders.snapshot().reminders.find((item) => item.id === reminder.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'quiet_hours' })
    } finally {
      quiet.close()
    }

    const stale = createHarness()
    try {
      enable(stale.reminders)
      const reminder = stale.reminders.schedule({ goalId: stale.goal.id, localDateTime: '2026-10-22T10:01' })
      stale.setNow('2026-10-23T02:02:00.000Z')
      stale.reminders.startScheduler()
      expect(stale.notifications.deliveries).toHaveLength(0)
      expect(stale.reminders.snapshot().reminders.find((item) => item.id === reminder.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'overdue' })
    } finally {
      stale.close()
    }
  })

  it('records failed native notifications without retrying them in a tight loop', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const reminder = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      harness.setNow('2026-10-22T02:02:00.000Z')
      harness.reminders.startScheduler()
      const delivery = harness.notifications.deliveries[0]!
      delivery.callbacks.onFailed()
      expect(delivery.close).toHaveBeenCalledOnce()
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === reminder.id))
        .toMatchObject({ status: 'suppressed', lastReason: 'notification_failed' })
    } finally {
      harness.close()
    }
  })

  it('cancels reminders when a goal stops or is deleted, and closes its displayed notice', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const stoppedReminder = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      harness.goals.stop(harness.goal.id)
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === stoppedReminder.id))
        .toMatchObject({ status: 'cancelled', lastReason: 'goal_inactive' })

      const deletedGoal = harness.goals.create(goalRequest)
      const deletedReminder = harness.reminders.schedule({ goalId: deletedGoal.id, localDateTime: '2026-10-22T10:03' })
      harness.setNow('2026-10-22T02:04:00.000Z')
      harness.reminders.startScheduler()
      const delivery = harness.notifications.deliveries[0]!
      delivery.callbacks.onShown()
      harness.goals.delete(deletedGoal.id)
      expect(delivery.close).toHaveBeenCalledOnce()
      expect(harness.database.connection.prepare('SELECT id FROM reminders WHERE id = ?').get(deletedReminder.id)).toBeUndefined()
    } finally {
      harness.close()
    }
  })

  it('refreshes reminder views after goal deletion cascades records before cancellation runs', () => {
    const notifyChanged = vi.fn()
    const harness = createHarness({ notifyChanged })
    try {
      enable(harness.reminders)
      harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      expect(harness.reminders.snapshot().reminders).toHaveLength(1)
      notifyChanged.mockClear()

      harness.goals.delete(harness.goal.id)

      expect(harness.reminders.snapshot().reminders).toHaveLength(0)
      expect(notifyChanged).toHaveBeenCalledOnce()
    } finally {
      harness.close()
    }
  })

  it('honors both per-pass count and elapsed-time dispatch budgets', () => {
    const countBound = createHarness()
    try {
      enable(countBound.reminders)
      for (let minute = 1; minute <= 12; minute += 1) {
        countBound.reminders.schedule({ goalId: countBound.goal.id, localDateTime: `2026-10-22T10:${String(minute).padStart(2, '0')}` })
      }
      countBound.setNow('2026-10-22T02:15:00.000Z')
      countBound.reminders.startScheduler()
      const records = countBound.reminders.snapshot().reminders
      expect(records.filter((item) => item.status !== 'scheduled')).toHaveLength(10)
      expect(records.filter((item) => item.status === 'scheduled')).toHaveLength(2)
    } finally {
      countBound.close()
    }

    let elapsed = 0
    const timeBound = createHarness({ monotonicNow: () => { elapsed += 100; return elapsed } })
    try {
      enable(timeBound.reminders)
      for (let minute = 1; minute <= 12; minute += 1) {
        timeBound.reminders.schedule({ goalId: timeBound.goal.id, localDateTime: `2026-10-22T10:${String(minute).padStart(2, '0')}` })
      }
      timeBound.setNow('2026-10-22T02:15:00.000Z')
      timeBound.reminders.startScheduler()
      const records = timeBound.reminders.snapshot().reminders
      expect(records.filter((item) => item.status !== 'scheduled')).toHaveLength(2)
      expect(records.filter((item) => item.status === 'scheduled')).toHaveLength(10)
    } finally {
      timeBound.close()
    }
  })

  it('stops a visible notification immediately when its goal-review type is disabled and ignores late callbacks', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const reminder = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      harness.setNow('2026-10-22T02:02:00.000Z')
      harness.reminders.startScheduler()
      const delivery = harness.notifications.deliveries[0]!
      const updated = harness.reminders.saveSettings(settings({ acceptConsent: false, goalReviewEnabled: false }))
      expect(updated.settings).toMatchObject({ enabled: true, goalReviewEnabled: false, consentStatus: 'active' })
      expect(delivery.close).toHaveBeenCalledOnce()
      delivery.callbacks.onShown()
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === reminder.id))
        .toMatchObject({ status: 'cancelled', lastReason: 'type_disabled' })
      expectApplicationError(() => harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T11:00' }), 'FORBIDDEN')
    } finally {
      harness.close()
    }
  })

  it('replays one overdue persisted schedule after restart when the notification was never shown', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-reminder-replay-'))
    const databasePath = join(directory, 'morrow.sqlite3')
    try {
      const first = createHarness({ databasePath })
      let reminderId = ''
      try {
        enable(first.reminders)
        reminderId = first.reminders.schedule({ goalId: first.goal.id, localDateTime: '2026-10-22T10:01' }).id
        first.setNow('2026-10-22T02:00:30.000Z')
        first.reminders.startScheduler()
        expect(first.notifications.deliveries).toHaveLength(0)
      } finally {
        first.close()
      }

      const restarted = createHarness({ databasePath })
      try {
        restarted.setNow('2026-10-22T02:02:00.000Z')
        restarted.reminders.startScheduler()
        expect(restarted.notifications.deliveries).toHaveLength(1)
        restarted.notifications.deliveries[0]!.callbacks.onShown()
        expect(restarted.reminders.snapshot().reminders.find((item) => item.id === reminderId))
          .toMatchObject({ status: 'shown', lastDecision: 'triggered', lastReason: 'triggered_after_restart' })
        expect(restarted.reminders.snapshot().recentDecisions[0]).toMatchObject({
          reminderId,
          ruleVersion: 'goal-review-v1',
          decision: 'triggered',
          reason: 'triggered_after_restart'
        })
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('recovers a notification interrupted while showing without replaying it twice', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-reminder-recovery-'))
    const databasePath = join(directory, 'morrow.sqlite3')
    try {
      const first = createHarness({ databasePath })
      let reminderId = ''
      try {
        enable(first.reminders)
        reminderId = first.reminders.schedule({ goalId: first.goal.id, localDateTime: '2026-10-22T10:01' }).id
        first.setNow('2026-10-22T02:02:00.000Z')
        first.reminders.startScheduler()
        expect(first.reminders.snapshot().reminders.find((item) => item.id === reminderId)?.status).toBe('showing')
      } finally {
        first.close()
      }

      const restarted = createHarness({ databasePath })
      try {
        restarted.setNow('2026-10-22T02:03:00.000Z')
        restarted.reminders.startScheduler()
        expect(restarted.notifications.deliveries).toHaveLength(0)
        expect(restarted.reminders.snapshot().reminders.find((item) => item.id === reminderId))
          .toMatchObject({ status: 'suppressed', lastReason: 'notification_failed' })
      } finally {
        restarted.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('clears terminal reminder history while retaining pending reminders and expires old terminal records', () => {
    const harness = createHarness()
    try {
      enable(harness.reminders)
      const shown = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T10:01' })
      const pending = harness.reminders.schedule({ goalId: harness.goal.id, localDateTime: '2026-10-22T11:00' })
      harness.setNow('2026-10-22T02:02:00.000Z')
      harness.reminders.startScheduler()
      harness.notifications.deliveries[0]!.callbacks.onShown()
      const cleared = harness.reminders.clearHistory()
      expect(cleared.reminders.map((item) => item.id)).toEqual([pending.id])
      expect(cleared.recentDecisions).toMatchObject([{ reminderId: pending.id, decision: 'scheduled' }])
      expect(harness.database.connection.prepare('SELECT id FROM reminders WHERE id = ?').get(shown.id)).toBeUndefined()

      const terminal = harness.reminders.cancel(pending.id)
      expect(terminal.status).toBe('cancelled')
      harness.database.connection.prepare('UPDATE reminders SET updated_at = ? WHERE id = ?')
        .run('2026-09-01T00:00:00.000Z', pending.id)
      expect(harness.reminders.snapshot().reminders.find((item) => item.id === pending.id)).toBeUndefined()
    } finally {
      harness.close()
    }
  })
})

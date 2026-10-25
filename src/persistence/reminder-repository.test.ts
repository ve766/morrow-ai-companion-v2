import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GOAL_DEFAULT_CONSTRAINTS, GOAL_SUCCESS_CRITERION, SUPPORTED_GOAL_INTENT } from '../motivation/goals'
import { defaultReminderSettings, REMINDER_CONSENT_VERSION, REMINDER_KIND, REMINDER_RULE_VERSION, type ReminderRecord } from '../motivation/reminders'
import { SqliteDatabase } from './database'
import { SqliteReminderRepository } from './reminder-repository'

const now = '2026-10-22T02:00:00.000Z'

function createGoal(database: SqliteDatabase, id = randomUUID()): string {
  database.connection.prepare(`
    INSERT INTO goals (
      id, intent, success_criterion, constraints_text, source_category, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'user_explicit_input', 'active', ?, ?)
  `).run(id, SUPPORTED_GOAL_INTENT, GOAL_SUCCESS_CRITERION, GOAL_DEFAULT_CONSTRAINTS, now, now)
  return id
}

function createReminder(goalId: string, overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: randomUUID(),
    goalId,
    kind: REMINDER_KIND,
    status: 'scheduled',
    scheduledAt: '2026-10-22T03:00:00.000Z',
    scheduledTimeZone: 'Asia/Shanghai',
    createdAt: now,
    updatedAt: now,
    shownAt: null,
    lastDecision: 'scheduled',
    lastReason: 'user_scheduled',
    ...overrides
  }
}

describe('SQLite reminder storage', () => {
  it('persists opt-out defaults and consented settings without exposing reminder content', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const store = new SqliteReminderRepository(database)
      const initial = store.getSettings('Asia/Shanghai', now)
      expect(initial).toEqual(defaultReminderSettings('Asia/Shanghai', now))
      expect(initial).toMatchObject({ enabled: false, consentStatus: 'never', consentedAt: null, revokedAt: null })

      const consented = {
        ...initial,
        enabled: true,
        consentStatus: 'active' as const,
        consentVersion: REMINDER_CONSENT_VERSION,
        consentedAt: now,
        updatedAt: now
      }
      store.saveSettings(consented)
      expect(store.getSettings('UTC', now)).toEqual(consented)
      expect(database.connection.prepare('SELECT count(*) AS count FROM reminders').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('writes a reminder decision atomically, rejects stale transitions, and cascades on goal deletion', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const store = new SqliteReminderRepository(database)
      const goalId = createGoal(database)
      const reminder = createReminder(goalId)
      store.createReminder(reminder, {
        reminderId: reminder.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })
      expect(store.listRecentDecisions(10)).toMatchObject([{ reminderId: reminder.id, decision: 'scheduled' }])

      expect(store.updateStatus(reminder.id, ['scheduled'], 'showing', 'displaying', 'triggered_on_time', now))
        .toMatchObject({ status: 'showing', shownAt: null })
      expect(store.updateStatus(reminder.id, ['scheduled'], 'cancelled', 'cancelled', 'paused', now)).toBeNull()
      expect(store.countShownSince('2026-10-21T02:00:00.000Z')).toBe(1)
      expect(store.lastShownAt()).toBe(now)

      expect(store.updateStatus(reminder.id, ['showing'], 'shown', 'triggered', 'triggered_on_time', now, now))
        .toMatchObject({ status: 'shown', shownAt: now })
      expect(store.countShownSince('2026-10-21T02:00:00.000Z')).toBe(1)
      expect(store.lastShownAt()).toBe(now)
      database.connection.prepare('DELETE FROM goals WHERE id = ?').run(goalId)
      expect(store.getReminder(reminder.id)).toBeNull()
      expect(store.listRecentDecisions(10)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('rolls back a failed reminder-and-decision insert as one unit', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const store = new SqliteReminderRepository(database)
      const goalId = createGoal(database)
      const reminder = createReminder(goalId)
      store.createReminder(reminder, {
        reminderId: reminder.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })
      expect(() => store.createReminder(reminder, {
        reminderId: reminder.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })).toThrow()
      expect(store.listRecentDecisions(10)).toHaveLength(1)
      expect(store.pendingCount()).toBe(1)
    } finally {
      database.close()
    }
  })

  it('cancels pending reminders transactionally and retains only recent decisions for active items when clearing history', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const store = new SqliteReminderRepository(database)
      const goalId = createGoal(database)
      const first = createReminder(goalId)
      const second = createReminder(goalId, { scheduledAt: '2026-10-22T04:00:00.000Z' })
      store.createReminder(first, {
        reminderId: first.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })
      store.createReminder(second, {
        reminderId: second.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })
      store.updateStatus(first.id, ['scheduled'], 'showing', 'displaying', 'triggered_on_time', now)
      const cancelled = store.cancelPending('paused', now)
      expect(cancelled).toEqual([first.id, second.id])
      expect(store.getReminder(first.id)).toMatchObject({ status: 'cancelled', lastReason: 'paused' })
      expect(store.getReminder(second.id)).toMatchObject({ status: 'cancelled', lastReason: 'paused' })
      expect(store.pendingCount()).toBe(0)
      expect(store.listRecentDecisions(10)).toHaveLength(5)

      const active = createReminder(goalId, { scheduledAt: '2026-10-22T05:00:00.000Z' })
      store.createReminder(active, {
        reminderId: active.id,
        happenedAt: now,
        ruleVersion: REMINDER_RULE_VERSION,
        decision: 'scheduled',
        reason: 'user_scheduled'
      })
      expect(store.clearHistory()).toEqual([first.id, second.id])
      expect(store.getReminder(first.id)).toBeNull()
      expect(store.getReminder(second.id)).toBeNull()
      expect(store.getReminder(active.id)).toMatchObject({ status: 'scheduled' })
      expect(store.listRecentDecisions(10)).toMatchObject([{ reminderId: active.id, decision: 'scheduled' }])
    } finally {
      database.close()
    }
  })
})

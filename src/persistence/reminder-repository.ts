import type {
  ReminderDecision,
  ReminderDecisionRecord,
  ReminderRecord,
  ReminderSettings,
  ReminderStatus
} from '../motivation/reminders'
import { defaultReminderSettings, REMINDER_MAX_DECISION_HISTORY, REMINDER_RULE_VERSION } from '../motivation/reminders'
import type { ReminderDecisionDraft, ReminderStore } from '../motivation/reminder-store'
import { SqliteDatabase } from './database'

interface SettingsRow {
  enabled: number
  goal_review_enabled: number
  consent_status: string
  consent_version: string | null
  consented_at: string | null
  revoked_at: string | null
  max_per_24_hours: number
  cooldown_minutes: number
  quiet_hours_enabled: number
  quiet_hours_start: string
  quiet_hours_end: string
  time_zone: string
  muted_until: string | null
  updated_at: string
}

interface ReminderRow {
  id: string
  goal_id: string
  kind: string
  status: string
  scheduled_at: string
  scheduled_time_zone: string
  created_at: string
  updated_at: string
  shown_at: string | null
  last_decision: string
  last_reason: string
}

interface DecisionRow {
  id: number
  reminder_id: string
  happened_at: string
  rule_version: string
  decision: string
  reason: string
}

function mapSettings(row: SettingsRow): ReminderSettings {
  return {
    enabled: row.enabled === 1,
    goalReviewEnabled: row.goal_review_enabled === 1,
    consentStatus: row.consent_status as ReminderSettings['consentStatus'],
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    revokedAt: row.revoked_at,
    maxPer24Hours: row.max_per_24_hours,
    cooldownMinutes: row.cooldown_minutes,
    quietHoursEnabled: row.quiet_hours_enabled === 1,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    timeZone: row.time_zone,
    mutedUntil: row.muted_until,
    updatedAt: row.updated_at
  }
}

function mapReminder(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    goalId: row.goal_id,
    kind: 'goal_review',
    status: row.status as ReminderStatus,
    scheduledAt: row.scheduled_at,
    scheduledTimeZone: row.scheduled_time_zone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shownAt: row.shown_at,
    lastDecision: row.last_decision as ReminderDecision,
    lastReason: row.last_reason as ReminderRecord['lastReason']
  }
}

function mapDecision(row: DecisionRow): ReminderDecisionRecord {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    happenedAt: row.happened_at,
    ruleVersion: row.rule_version,
    decision: row.decision as ReminderDecision,
    reason: row.reason as ReminderDecisionRecord['reason']
  }
}

export class SqliteReminderRepository implements ReminderStore {
  constructor(private readonly database: SqliteDatabase) {}

  getSettings(timeZone: string, now: string): ReminderSettings {
    const defaults = defaultReminderSettings(timeZone, now)
    this.database.connection.prepare(`
      INSERT INTO reminder_settings (
        id, enabled, goal_review_enabled, consent_status, consent_version, consented_at, revoked_at,
        max_per_24_hours, cooldown_minutes, quiet_hours_enabled, quiet_hours_start,
        quiet_hours_end, time_zone, muted_until, updated_at
      ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      Number(defaults.enabled), Number(defaults.goalReviewEnabled), defaults.consentStatus,
      defaults.consentVersion, defaults.consentedAt,
      defaults.revokedAt, defaults.maxPer24Hours, defaults.cooldownMinutes, Number(defaults.quietHoursEnabled),
      defaults.quietHoursStart, defaults.quietHoursEnd, defaults.timeZone, defaults.mutedUntil, defaults.updatedAt
    )
    const row = this.database.connection.prepare('SELECT * FROM reminder_settings WHERE id = ?').get('primary') as unknown as SettingsRow | undefined
    if (!row) throw new Error('Reminder settings are unavailable.')
    return mapSettings(row)
  }

  saveSettings(settings: ReminderSettings): void {
    this.database.connection.prepare(`
      INSERT INTO reminder_settings (
        id, enabled, goal_review_enabled, consent_status, consent_version, consented_at, revoked_at,
        max_per_24_hours, cooldown_minutes, quiet_hours_enabled, quiet_hours_start,
        quiet_hours_end, time_zone, muted_until, updated_at
      ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        goal_review_enabled = excluded.goal_review_enabled,
        consent_status = excluded.consent_status,
        consent_version = excluded.consent_version,
        consented_at = excluded.consented_at,
        revoked_at = excluded.revoked_at,
        max_per_24_hours = excluded.max_per_24_hours,
        cooldown_minutes = excluded.cooldown_minutes,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        time_zone = excluded.time_zone,
        muted_until = excluded.muted_until,
        updated_at = excluded.updated_at
    `).run(
      Number(settings.enabled), Number(settings.goalReviewEnabled), settings.consentStatus,
      settings.consentVersion, settings.consentedAt,
      settings.revokedAt, settings.maxPer24Hours, settings.cooldownMinutes, Number(settings.quietHoursEnabled),
      settings.quietHoursStart, settings.quietHoursEnd, settings.timeZone, settings.mutedUntil, settings.updatedAt
    )
  }

  createReminder(reminder: ReminderRecord, decision: ReminderDecisionDraft): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO reminders (
          id, goal_id, kind, status, scheduled_at, scheduled_time_zone, created_at, updated_at,
          shown_at, last_decision, last_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reminder.id, reminder.goalId, reminder.kind, reminder.status, reminder.scheduledAt,
        reminder.scheduledTimeZone, reminder.createdAt, reminder.updatedAt, reminder.shownAt,
        reminder.lastDecision, reminder.lastReason
      )
      this.insertDecision(decision)
    })
  }

  getReminder(reminderId: string): ReminderRecord | null {
    const row = this.database.connection.prepare('SELECT * FROM reminders WHERE id = ?').get(reminderId) as unknown as ReminderRow | undefined
    return row ? mapReminder(row) : null
  }

  listReminders(limit: number): ReminderRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.database.connection.prepare(`
      SELECT * FROM reminders ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'showing' THEN 1 ELSE 2 END,
        scheduled_at, created_at DESC, id LIMIT ?
    `).all(boundedLimit) as unknown as ReminderRow[]
    return rows.map(mapReminder)
  }

  listRecentDecisions(limit: number): ReminderDecisionRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.database.connection.prepare(`
      SELECT id, reminder_id, happened_at, rule_version, decision, reason
      FROM reminder_decisions ORDER BY happened_at DESC, id DESC LIMIT ?
    `).all(boundedLimit) as unknown as DecisionRow[]
    return rows.map(mapDecision)
  }

  pendingReminders(): ReminderRecord[] {
    const rows = this.database.connection.prepare("SELECT * FROM reminders WHERE status IN ('scheduled', 'showing') ORDER BY scheduled_at, id")
      .all() as unknown as ReminderRow[]
    return rows.map(mapReminder)
  }

  pendingCount(): number {
    const row = this.database.connection.prepare("SELECT count(*) AS count FROM reminders WHERE status IN ('scheduled', 'showing')")
      .get() as unknown as { count: number }
    return row.count
  }

  dueReminders(now: string, limit: number): ReminderRecord[] {
    const boundedLimit = Math.max(1, Math.min(10, Math.trunc(limit)))
    const rows = this.database.connection.prepare(`
      SELECT * FROM reminders WHERE status = 'scheduled' AND scheduled_at <= ?
      ORDER BY scheduled_at, id LIMIT ?
    `).all(now, boundedLimit) as unknown as ReminderRow[]
    return rows.map(mapReminder)
  }

  nextScheduledAt(): string | null {
    const row = this.database.connection.prepare("SELECT MIN(scheduled_at) AS scheduled_at FROM reminders WHERE status = 'scheduled'")
      .get() as unknown as { scheduled_at: string | null }
    return row.scheduled_at
  }

  countShownSince(instant: string): number {
    const row = this.database.connection.prepare(`
      SELECT count(*) AS count FROM reminders
      WHERE status = 'shown' AND shown_at >= ?
        OR status = 'showing' AND updated_at >= ?
    `).get(instant, instant) as unknown as { count: number }
    return row.count
  }

  lastShownAt(): string | null {
    const row = this.database.connection.prepare(`
      SELECT MAX(CASE WHEN status = 'shown' THEN shown_at ELSE updated_at END) AS shown_at
      FROM reminders WHERE status IN ('shown', 'showing')
    `).get() as unknown as { shown_at: string | null }
    return row.shown_at
  }

  recoverShowing(now: string): void {
    this.database.transaction(() => {
      const rows = this.database.connection.prepare("SELECT id FROM reminders WHERE status = 'showing'")
        .all() as unknown as Array<{ id: string }>
      for (const row of rows) {
        this.updateStatusInTransaction(row.id, ['showing'], 'suppressed', 'suppressed', 'notification_failed', now)
      }
    })
  }

  updateStatus(
    reminderId: string,
    expected: readonly ReminderStatus[],
    status: ReminderStatus,
    decision: ReminderDecision,
    reason: ReminderRecord['lastReason'],
    now: string,
    shownAt?: string | null
  ): ReminderRecord | null {
    return this.database.transaction(() => this.updateStatusInTransaction(reminderId, expected, status, decision, reason, now, shownAt))
  }

  private updateStatusInTransaction(
    reminderId: string,
    expected: readonly ReminderStatus[],
    status: ReminderStatus,
    decision: ReminderDecision,
    reason: ReminderRecord['lastReason'],
    now: string,
    shownAt?: string | null
  ): ReminderRecord | null {
    const current = this.getReminder(reminderId)
    if (!current || !expected.includes(current.status)) return null
    if (shownAt === undefined) {
      this.database.connection.prepare(`
        UPDATE reminders SET status = ?, last_decision = ?, last_reason = ?, updated_at = ? WHERE id = ?
      `).run(status, decision, reason, now, reminderId)
    } else {
      this.database.connection.prepare(`
        UPDATE reminders SET status = ?, last_decision = ?, last_reason = ?, updated_at = ?, shown_at = ? WHERE id = ?
      `).run(status, decision, reason, now, shownAt, reminderId)
    }
    this.insertDecision({ reminderId, happenedAt: now, ruleVersion: REMINDER_RULE_VERSION, decision, reason })
    return this.getReminder(reminderId)
  }

  cancelPending(reason: ReminderDecisionRecord['reason'], now: string, goalId?: string): string[] {
    return this.database.transaction(() => {
      const rows = this.database.connection.prepare(`
        SELECT id, status FROM reminders
        WHERE status IN ('scheduled', 'showing') ${goalId ? 'AND goal_id = ?' : ''}
        ORDER BY scheduled_at, id
      `).all(...(goalId ? [goalId] : [])) as unknown as Array<{ id: string; status: ReminderStatus }>
      for (const row of rows) {
        this.updateStatusInTransaction(row.id, [row.status], 'cancelled', 'cancelled', reason, now)
      }
      return rows.map((row) => row.id)
    })
  }

  reschedule(reminder: ReminderRecord, decision: ReminderDecisionDraft): ReminderRecord | null {
    return this.database.transaction(() => {
      const current = this.getReminder(reminder.id)
      if (!current || !['scheduled', 'suppressed', 'cancelled'].includes(current.status)) return null
      this.database.connection.prepare(`
        UPDATE reminders SET status = ?, scheduled_at = ?, scheduled_time_zone = ?, updated_at = ?,
          last_decision = ?, last_reason = ?, shown_at = NULL WHERE id = ?
      `).run(
        reminder.status, reminder.scheduledAt, reminder.scheduledTimeZone, reminder.updatedAt,
        reminder.lastDecision, reminder.lastReason, reminder.id
      )
      this.insertDecision(decision)
      return this.getReminder(reminder.id)
    })
  }

  clearHistory(): string[] {
    return this.database.transaction(() => {
      const rows = this.database.connection.prepare("SELECT id FROM reminders WHERE status IN ('shown', 'suppressed', 'cancelled')")
        .all() as unknown as Array<{ id: string }>
      this.database.connection.prepare("DELETE FROM reminders WHERE status IN ('shown', 'suppressed', 'cancelled')").run()
      this.database.connection.prepare(`
        DELETE FROM reminder_decisions
        WHERE reminder_id IN (SELECT id FROM reminders WHERE status IN ('scheduled', 'showing'))
          AND id NOT IN (
            SELECT MAX(d.id) FROM reminder_decisions AS d
            JOIN reminders AS r ON r.id = d.reminder_id
            WHERE r.status IN ('scheduled', 'showing') GROUP BY d.reminder_id
          )
      `).run()
      return rows.map((row) => row.id)
    })
  }

  pruneHistory(cutoff: string): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`
        DELETE FROM reminders WHERE status IN ('shown', 'suppressed', 'cancelled') AND updated_at < ?
      `).run(cutoff)
      this.database.connection.prepare(`
        DELETE FROM reminder_decisions
        WHERE happened_at < ?
          AND id NOT IN (
            SELECT MAX(d.id) FROM reminder_decisions AS d
            JOIN reminders AS r ON r.id = d.reminder_id
            WHERE r.status IN ('scheduled', 'showing') GROUP BY d.reminder_id
          )
      `).run(cutoff)
      this.database.connection.prepare(`
        DELETE FROM reminder_decisions
        WHERE id NOT IN (
          SELECT id FROM reminder_decisions ORDER BY happened_at DESC, id DESC LIMIT ?
        )
          AND id NOT IN (
            SELECT MAX(d.id) FROM reminder_decisions AS d
            JOIN reminders AS r ON r.id = d.reminder_id
            WHERE r.status IN ('scheduled', 'showing') GROUP BY d.reminder_id
          )
      `).run(REMINDER_MAX_DECISION_HISTORY)
    })
  }

  private insertDecision(decision: ReminderDecisionDraft): void {
    this.database.connection.prepare(`
      INSERT INTO reminder_decisions(reminder_id, happened_at, rule_version, decision, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(decision.reminderId, decision.happenedAt, decision.ruleVersion, decision.decision, decision.reason)
  }
}

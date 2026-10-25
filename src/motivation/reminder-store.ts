import type {
  ReminderDecision,
  ReminderDecisionReason,
  ReminderDecisionRecord,
  ReminderRecord,
  ReminderSettings,
  ReminderStatus
} from './reminders'

export interface ReminderDecisionDraft {
  reminderId: string
  happenedAt: string
  ruleVersion: string
  decision: ReminderDecision
  reason: ReminderDecisionReason
}

export interface ReminderStore {
  getSettings(timeZone: string, now: string): ReminderSettings
  saveSettings(settings: ReminderSettings): void
  createReminder(reminder: ReminderRecord, decision: ReminderDecisionDraft): void
  getReminder(reminderId: string): ReminderRecord | null
  listReminders(limit: number): ReminderRecord[]
  listRecentDecisions(limit: number): ReminderDecisionRecord[]
  pendingReminders(): ReminderRecord[]
  pendingCount(): number
  dueReminders(now: string, limit: number): ReminderRecord[]
  nextScheduledAt(): string | null
  countShownSince(instant: string): number
  lastShownAt(): string | null
  recoverShowing(now: string): void
  updateStatus(
    reminderId: string,
    expected: readonly ReminderStatus[],
    status: ReminderStatus,
    decision: ReminderDecision,
    reason: ReminderDecisionReason,
    now: string,
    shownAt?: string | null
  ): ReminderRecord | null
  cancelPending(reason: ReminderDecisionReason, now: string, goalId?: string): string[]
  reschedule(reminder: ReminderRecord, decision: ReminderDecisionDraft): ReminderRecord | null
  clearHistory(): string[]
  pruneHistory(cutoff: string): void
}

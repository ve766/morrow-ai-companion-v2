import type { GoalActionRecord, GoalAuditEvent, GoalAuditReason, GoalAuditRecord, GoalStatus, TaskRecord } from './goals'

export interface GoalEvidenceVerification {
  taskId: string
  toolId: GoalActionRecord['toolId']
  toolVersion: GoalActionRecord['toolVersion']
  resultCount: number | null
  verifiedCount: number | null
  verificationStatus: GoalActionRecord['verificationStatus']
}

export interface GoalEvidenceEntry {
  seq: number
  event: GoalAuditEvent
  reason: GoalAuditReason
  status: GoalStatus | TaskRecord['status']
  taskId: string | null
  actionId: string | null
  happenedAt: string
  happenedAtValid: boolean
  resultCount: number | null
  verifiedCount: number | null
  verification: GoalEvidenceVerification | null
}

function happenedAtValue(happenedAt: string): { valid: boolean; order: number } {
  const parsed = Date.parse(happenedAt)
  if (!Number.isFinite(parsed)) return { valid: false, order: Number.POSITIVE_INFINITY }
  return { valid: true, order: parsed }
}

// Builds the user-visible progress-evidence ledger for one goal. Audit rows
// are the ledger of record; the task's independently verified tool result is
// joined by (taskId, actionId) so verification numbers shown next to an event
// come from the persisted task, never from the event alone. Inputs are
// read-only; rows are deduplicated by seq (first wins) and ordered by the
// audit sequence with deterministic tiebreaks; unparsable timestamps are
// flagged, not silently rendered.
export function buildGoalEvidenceTimeline(audit: readonly GoalAuditRecord[], tasks: readonly TaskRecord[]): GoalEvidenceEntry[] {
  const verificationByAction = new Map<string, GoalEvidenceVerification>()
  for (const task of tasks) {
    verificationByAction.set(`${task.id}:${task.action.id}`, {
      taskId: task.id,
      toolId: task.action.toolId,
      toolVersion: task.action.toolVersion,
      resultCount: task.action.resultCount,
      verifiedCount: task.action.verifiedCount,
      verificationStatus: task.action.verificationStatus
    })
  }
  const entries = new Map<number, GoalEvidenceEntry>()
  for (const row of audit) {
    if (entries.has(row.seq)) continue
    const { valid, order } = happenedAtValue(row.happenedAt)
    const verification = row.taskId !== null && row.actionId !== null
      ? verificationByAction.get(`${row.taskId}:${row.actionId}`) ?? null
      : null
    entries.set(row.seq, {
      seq: row.seq,
      event: row.event,
      reason: row.reason,
      status: row.status,
      taskId: row.taskId,
      actionId: row.actionId,
      happenedAt: row.happenedAt,
      happenedAtValid: valid,
      resultCount: row.resultCount,
      verifiedCount: row.verifiedCount,
      verification,
      order
    } as GoalEvidenceEntry & { order: number })
  }
  const list = [...entries.values()] as Array<GoalEvidenceEntry & { order: number }>
  list.sort((left, right) =>
    left.seq - right.seq
    || left.order - right.order
    || (left.event < right.event ? -1 : left.event > right.event ? 1 : 0))
  return list.map(({ order: _order, ...entry }) => entry)
}

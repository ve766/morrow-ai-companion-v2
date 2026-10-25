import type {
  GoalActionRecord,
  GoalAuditEvent,
  GoalAuditReason,
  GoalAuditRecord,
  GoalListItem,
  GoalRecord,
  GoalStatus,
  TaskRecord,
  TaskStatus,
  VerificationStatus
} from './goals'

export interface GoalAuditDraft {
  goalId: string
  taskId: string | null
  actionId: string | null
  event: GoalAuditEvent
  reason: GoalAuditReason
  status: GoalStatus | TaskStatus
  happenedAt: string
  resultCount: number | null
  verifiedCount: number | null
}

export interface StoredGoalAction extends GoalActionRecord {
  parametersJson: string
}

export interface GoalApprovalRecord {
  id: string
  taskId: string
  actionId: string
  toolId: string
  toolVersion: string
  parametersHash: string
  resourceScope: string
  risk: string
  expiresAt: string
  approvedAt: string
  consumedAt: string
}

export interface GoalStopResult {
  taskIds: string[]
}

export interface GoalStore {
  createGoal(goal: GoalRecord, audit: GoalAuditDraft): void
  list(): GoalListItem[]
  getGoal(goalId: string): GoalRecord | null
  getTask(taskId: string): TaskRecord | null
  getStoredAction(taskId: string): StoredGoalAction | null
  previousTaskStatuses(goalId: string): TaskStatus[]
  pendingTaskCount(): number
  createTask(task: TaskRecord, parametersJson: string, audits: readonly GoalAuditDraft[], maxPending: number): void
  requestApproval(taskId: string, expiresAt: string, updatedAt: string, audit: GoalAuditDraft): TaskRecord
  rejectApproval(taskId: string, now: string, expired: boolean): TaskRecord
  startApprovedTask(approval: GoalApprovalRecord, now: string, audits: readonly GoalAuditDraft[]): TaskRecord
  completeRunningTask(
    taskId: string,
    status: Exclude<TaskStatus, 'queued' | 'awaiting_approval' | 'running' | 'cancelled'>,
    now: string,
    resultCount: number | null,
    verifiedCount: number | null,
    verificationStatus: VerificationStatus,
    audit: GoalAuditDraft
  ): TaskRecord | null
  cancelTask(taskId: string, now: string): { task: TaskRecord; shouldTerminate: boolean }
  stopGoal(goalId: string, now: string): GoalStopResult
  pendingTaskIds(goalId: string): string[]
  deleteGoal(goalId: string): boolean
  recoverInterrupted(now: string): void
}

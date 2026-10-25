import { ApplicationError } from '../shared/errors'
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
} from '../motivation/goals'
import {
  GOAL_SOURCE_CATEGORY,
  GOAL_SUCCESS_CRITERION,
  MEMORY_COUNT_RESOURCE_SCOPE,
  MEMORY_COUNT_TOOL_ID,
  MEMORY_COUNT_TOOL_VERSION
} from '../motivation/goals'
import { SqliteDatabase } from './database'

import type { GoalApprovalRecord, GoalAuditDraft, GoalStore, StoredGoalAction } from '../motivation/goal-store'

interface GoalRow {
  id: string
  intent: string
  success_criterion: string
  constraints_text: string
  source_category: string
  status: string
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: string
  goal_id: string
  status: string
  created_at: string
  updated_at: string
  action_id: string
  tool_id: string
  tool_version: string
  parameters_json: string
  parameters_hash: string
  resource_scope: string
  risk: string
  action_status: string
  planned_at: string
  approval_expires_at: string | null
  started_at: string | null
  completed_at: string | null
  idempotency_key: string
  result_count: number | null
  verified_count: number | null
  verification_status: string
  verification_at: string | null
}

interface AuditRow {
  seq: number
  goal_id: string
  task_id: string | null
  action_id: string | null
  event: string
  reason: string
  status: string
  happened_at: string
  result_count: number | null
  verified_count: number | null
}

function mapGoal(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    intent: row.intent,
    successCriterion: GOAL_SUCCESS_CRITERION,
    constraints: row.constraints_text,
    sourceCategory: GOAL_SOURCE_CATEGORY,
    status: row.status as GoalStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapTask(row: TaskRow): TaskRecord {
  const action: GoalActionRecord = {
    id: row.action_id,
    toolId: row.tool_id as GoalActionRecord['toolId'],
    toolVersion: row.tool_version as GoalActionRecord['toolVersion'],
    parametersHash: row.parameters_hash,
    resourceScope: row.resource_scope as GoalActionRecord['resourceScope'],
    risk: row.risk as GoalActionRecord['risk'],
    status: row.action_status as TaskStatus,
    plannedAt: row.planned_at,
    approvalExpiresAt: row.approval_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    idempotencyKey: row.idempotency_key,
    resultCount: row.result_count,
    verifiedCount: row.verified_count,
    verificationStatus: row.verification_status as VerificationStatus,
    verificationAt: row.verification_at
  }
  return {
    id: row.id,
    goalId: row.goal_id,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    action,
    approvalChallenge: null
  }
}

function mapAudit(row: AuditRow): GoalAuditRecord {
  return {
    seq: row.seq,
    goalId: row.goal_id,
    taskId: row.task_id,
    actionId: row.action_id,
    event: row.event as GoalAuditEvent,
    reason: row.reason as GoalAuditReason,
    status: row.status as GoalStatus | TaskStatus,
    happenedAt: row.happened_at,
    resultCount: row.result_count,
    verifiedCount: row.verified_count
  }
}

export class SqliteGoalRepository implements GoalStore {
  constructor(private readonly database: SqliteDatabase) {}

  createGoal(goal: GoalRecord, audit: GoalAuditDraft): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO goals(id, intent, success_criterion, constraints_text, source_category, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        goal.id,
        goal.intent,
        goal.successCriterion,
        goal.constraints,
        goal.sourceCategory,
        goal.status,
        goal.createdAt,
        goal.updatedAt
      )
      this.insertAudit(audit)
    })
  }

  list(): GoalListItem[] {
    const rows = this.database.connection.prepare('SELECT * FROM goals ORDER BY created_at DESC, id').all() as unknown as GoalRow[]
    return rows.map((row) => ({
      goal: mapGoal(row),
      tasks: this.tasksForGoal(row.id),
      audit: this.auditForGoal(row.id)
    }))
  }

  getGoal(goalId: string): GoalRecord | null {
    const row = this.database.connection.prepare('SELECT * FROM goals WHERE id = ?').get(goalId) as unknown as GoalRow | undefined
    return row ? mapGoal(row) : null
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.getTaskRow(taskId)
    return row ? mapTask(row) : null
  }

  getStoredAction(taskId: string): StoredGoalAction | null {
    const row = this.getTaskRow(taskId)
    if (!row) return null
    return {
      id: row.action_id,
      toolId: row.tool_id as StoredGoalAction['toolId'],
      toolVersion: row.tool_version as StoredGoalAction['toolVersion'],
      parametersJson: row.parameters_json,
      parametersHash: row.parameters_hash,
      resourceScope: row.resource_scope as StoredGoalAction['resourceScope'],
      risk: row.risk as StoredGoalAction['risk'],
      status: row.action_status as TaskStatus,
      plannedAt: row.planned_at,
      approvalExpiresAt: row.approval_expires_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      idempotencyKey: row.idempotency_key,
      resultCount: row.result_count,
      verifiedCount: row.verified_count,
      verificationStatus: row.verification_status as VerificationStatus,
      verificationAt: row.verification_at
    }
  }

  previousTaskStatuses(goalId: string): TaskStatus[] {
    const rows = this.database.connection.prepare('SELECT status FROM goal_tasks WHERE goal_id = ? ORDER BY created_at, id').all(goalId) as unknown as Array<{ status: string }>
    return rows.map((row) => row.status as TaskStatus)
  }

  pendingTaskCount(): number {
    const row = this.database.connection.prepare(`
      SELECT count(*) AS count FROM goal_tasks
      WHERE status IN ('queued', 'awaiting_approval', 'running')
    `).get() as unknown as { count: number }
    return row.count
  }

  createTask(task: TaskRecord, parametersJson: string, audits: readonly GoalAuditDraft[], maxPending: number): void {
    this.database.transaction(() => {
      const goal = this.getGoal(task.goalId)
      if (!goal || goal.status !== 'active') throw new ApplicationError('CONFLICT')
      if (this.pendingTaskCount() >= maxPending) throw new ApplicationError('CONFLICT')
      if (this.previousTaskStatuses(task.goalId).some((status) => status === 'queued' || status === 'awaiting_approval' || status === 'running')) {
        throw new ApplicationError('CONFLICT')
      }
      this.database.connection.prepare(`
        INSERT INTO goal_tasks(id, goal_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(task.id, task.goalId, task.status, task.createdAt, task.updatedAt)
      this.database.connection.prepare(`
        INSERT INTO goal_actions(
          id, task_id, tool_id, tool_version, parameters_json, parameters_hash,
          resource_scope, risk, status, planned_at, approval_expires_at,
          started_at, completed_at, idempotency_key, result_count,
          verified_count, verification_status, verification_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.action.id,
        task.id,
        task.action.toolId,
        task.action.toolVersion,
        parametersJson,
        task.action.parametersHash,
        task.action.resourceScope,
        task.action.risk,
        task.action.status,
        task.action.plannedAt,
        task.action.approvalExpiresAt,
        task.action.startedAt,
        task.action.completedAt,
        task.action.idempotencyKey,
        task.action.resultCount,
        task.action.verifiedCount,
        task.action.verificationStatus,
        task.action.verificationAt
      )
      for (const audit of audits) this.insertAudit(audit)
    })
  }

  requestApproval(taskId: string, expiresAt: string, updatedAt: string, audit: GoalAuditDraft): TaskRecord {
    return this.database.transaction(() => {
      const current = this.getTask(taskId)
      const goal = current ? this.getGoal(current.goalId) : null
      if (!current || !goal || goal.status !== 'active' || current.status !== 'queued') throw new ApplicationError('CONFLICT')
      const taskUpdate = this.database.connection.prepare(`
        UPDATE goal_tasks SET status = 'awaiting_approval', updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(updatedAt, taskId)
      const actionUpdate = this.database.connection.prepare(`
        UPDATE goal_actions SET status = 'awaiting_approval', approval_expires_at = ?
        WHERE task_id = ? AND status = 'queued'
      `).run(expiresAt, taskId)
      if (taskUpdate.changes !== 1 || actionUpdate.changes !== 1) throw new ApplicationError('CONFLICT')
      this.insertAudit(audit)
      return this.getTask(taskId)!
    })
  }

  rejectApproval(taskId: string, now: string, expired: boolean): TaskRecord {
    return this.database.transaction(() => {
      const current = this.getTask(taskId)
      if (!current || current.status !== 'awaiting_approval') throw new ApplicationError('CONFLICT')
      const nextStatus: TaskStatus = 'cancelled'
      this.updateStatus(taskId, current.status, nextStatus, now, true)
      this.insertAudit({
        goalId: current.goalId,
        taskId,
        actionId: current.action.id,
        event: expired ? 'approval_expired' : 'approval_rejected',
        reason: expired ? 'approval_expired' : 'user_rejected',
        status: nextStatus,
        happenedAt: now,
        resultCount: null,
        verifiedCount: null
      })
      this.insertAudit({
        goalId: current.goalId,
        taskId,
        actionId: current.action.id,
        event: 'task_cancelled',
        reason: expired ? 'approval_expired' : 'user_rejected',
        status: nextStatus,
        happenedAt: now,
        resultCount: null,
        verifiedCount: null
      })
      return this.getTask(taskId)!
    })
  }

  startApprovedTask(approval: GoalApprovalRecord, now: string, audits: readonly GoalAuditDraft[]): TaskRecord {
    return this.database.transaction(() => {
      const current = this.getTask(approval.taskId)
      const action = this.getStoredAction(approval.taskId)
      const goal = current ? this.getGoal(current.goalId) : null
      if (!current || !action || !goal || current.status !== 'awaiting_approval' || goal.status !== 'active') {
        throw new ApplicationError('CONFLICT')
      }
      if (!action.approvalExpiresAt || action.approvalExpiresAt <= now) {
        this.updateStatus(approval.taskId, current.status, 'cancelled', now, true)
        this.insertAudit({
          goalId: current.goalId,
          taskId: current.id,
          actionId: current.action.id,
          event: 'approval_expired',
          reason: 'approval_expired',
          status: 'cancelled',
          happenedAt: now,
          resultCount: null,
          verifiedCount: null
        })
        this.insertAudit({
          goalId: current.goalId,
          taskId: current.id,
          actionId: current.action.id,
          event: 'task_cancelled',
          reason: 'approval_expired',
          status: 'cancelled',
          happenedAt: now,
          resultCount: null,
          verifiedCount: null
        })
        return this.getTask(approval.taskId)!
      }
      if (
        this.approvalExists(approval.taskId) ||
        action.parametersJson !== '{}' ||
        approval.actionId !== action.id ||
        approval.toolId !== action.toolId ||
        approval.toolVersion !== action.toolVersion ||
        approval.parametersHash !== action.parametersHash ||
        approval.resourceScope !== action.resourceScope ||
        approval.risk !== action.risk ||
        approval.expiresAt !== action.approvalExpiresAt ||
        action.toolId !== MEMORY_COUNT_TOOL_ID ||
        action.toolVersion !== MEMORY_COUNT_TOOL_VERSION ||
        action.parametersHash !== this.expectedParametersHash() ||
        action.resourceScope !== MEMORY_COUNT_RESOURCE_SCOPE ||
        action.risk !== 'read-only'
      ) {
        throw new ApplicationError('FORBIDDEN')
      }
      this.database.connection.prepare(`
        INSERT INTO goal_approvals(
          id, task_id, action_id, tool_id, tool_version, parameters_hash,
          resource_scope, risk, expires_at, approved_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approval.id,
        approval.taskId,
        approval.actionId,
        approval.toolId,
        approval.toolVersion,
        approval.parametersHash,
        approval.resourceScope,
        approval.risk,
        approval.expiresAt,
        approval.approvedAt,
        approval.consumedAt
      )
      const taskUpdate = this.database.connection.prepare(`
        UPDATE goal_tasks SET status = 'running', updated_at = ?
        WHERE id = ? AND status = 'awaiting_approval'
      `).run(now, approval.taskId)
      const actionUpdate = this.database.connection.prepare(`
        UPDATE goal_actions SET status = 'running', started_at = ?
        WHERE task_id = ? AND status = 'awaiting_approval'
      `).run(now, approval.taskId)
      if (taskUpdate.changes !== 1 || actionUpdate.changes !== 1) throw new ApplicationError('CONFLICT')
      for (const audit of audits) this.insertAudit(audit)
      return this.getTask(approval.taskId)!
    })
  }

  completeRunningTask(
    taskId: string,
    status: Exclude<TaskStatus, 'queued' | 'awaiting_approval' | 'running' | 'cancelled'>,
    now: string,
    resultCount: number | null,
    verifiedCount: number | null,
    verificationStatus: VerificationStatus,
    audit: GoalAuditDraft
  ): TaskRecord | null {
    return this.database.transaction(() => {
      const current = this.getTask(taskId)
      if (!current || current.status !== 'running') return null
      const taskUpdate = this.database.connection.prepare(`
        UPDATE goal_tasks SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'
      `).run(status, now, taskId)
      const actionUpdate = this.database.connection.prepare(`
        UPDATE goal_actions SET status = ?, completed_at = ?, result_count = ?, verified_count = ?,
          verification_status = ?, verification_at = ?
        WHERE task_id = ? AND status = 'running'
      `).run(status, now, resultCount, verifiedCount, verificationStatus, verificationStatus === 'not_run' ? null : now, taskId)
      if (taskUpdate.changes !== 1 || actionUpdate.changes !== 1) throw new ApplicationError('CONFLICT')
      if (status === 'succeeded') {
        this.database.connection.prepare(`
          UPDATE goals SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'active'
        `).run(now, current.goalId)
      }
      this.insertAudit(audit)
      return this.getTask(taskId)
    })
  }

  cancelTask(taskId: string, now: string): { task: TaskRecord; shouldTerminate: boolean } {
    return this.database.transaction(() => {
      const current = this.getTask(taskId)
      if (!current || !['queued', 'awaiting_approval', 'running'].includes(current.status)) throw new ApplicationError('CONFLICT')
      const nextStatus: TaskStatus = current.status === 'running' ? 'outcome_unknown' : 'cancelled'
      this.updateStatus(taskId, current.status, nextStatus, now, true)
      const unknown = nextStatus === 'outcome_unknown'
      this.insertAudit({
        goalId: current.goalId,
        taskId,
        actionId: current.action.id,
        event: unknown ? 'outcome_unknown' : 'task_cancelled',
        reason: 'user_cancelled',
        status: nextStatus,
        happenedAt: now,
        resultCount: null,
        verifiedCount: null
      })
      return { task: this.getTask(taskId)!, shouldTerminate: unknown }
    })
  }

  stopGoal(goalId: string, now: string): { taskIds: string[] } {
    return this.database.transaction(() => {
      const goal = this.getGoal(goalId)
      if (!goal || goal.status !== 'active') throw new ApplicationError('CONFLICT')
      this.database.connection.prepare(`UPDATE goals SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'`)
        .run(now, goalId)
      const pending = this.database.connection.prepare(`
        SELECT id FROM goal_tasks WHERE goal_id = ? AND status IN ('queued', 'awaiting_approval', 'running')
      `).all(goalId) as unknown as Array<{ id: string }>
      for (const { id } of pending) {
        const current = this.getTask(id)
        if (!current) continue
        const next: TaskStatus = current.status === 'running' ? 'outcome_unknown' : 'cancelled'
        this.updateStatus(id, current.status, next, now, true)
        this.insertAudit({
          goalId,
          taskId: id,
          actionId: current.action.id,
          event: next === 'outcome_unknown' ? 'outcome_unknown' : 'task_cancelled',
          reason: 'user_stopped_goal',
          status: next,
          happenedAt: now,
          resultCount: null,
          verifiedCount: null
        })
      }
      this.insertAudit({
        goalId,
        taskId: null,
        actionId: null,
        event: 'goal_stopped',
        reason: 'user_stopped_goal',
        status: 'cancelled',
        happenedAt: now,
        resultCount: null,
        verifiedCount: null
      })
      return { taskIds: pending.map(({ id }) => id) }
    })
  }

  pendingTaskIds(goalId: string): string[] {
    const rows = this.database.connection.prepare(`
      SELECT id FROM goal_tasks WHERE goal_id = ? AND status IN ('queued', 'awaiting_approval', 'running')
    `).all(goalId) as unknown as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  deleteGoal(goalId: string): boolean {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare('DELETE FROM goals WHERE id = ?').run(goalId)
      return result.changes === 1
    })
  }

  recoverInterrupted(now: string): void {
    this.database.transaction(() => {
      const rows = this.database.connection.prepare(`
        SELECT id, goal_id, status FROM goal_tasks
        WHERE status IN ('queued', 'running')
           OR (status = 'awaiting_approval' AND EXISTS (
             SELECT 1 FROM goal_actions WHERE task_id = goal_tasks.id AND approval_expires_at <= ?
           ))
      `).all(now) as unknown as Array<{ id: string; goal_id: string; status: TaskStatus }>
      for (const row of rows) {
        const next: TaskStatus = row.status === 'running' ? 'outcome_unknown' : 'cancelled'
        this.updateStatus(row.id, row.status, next, now, true)
        if (row.status === 'awaiting_approval') {
          this.insertAudit({
            goalId: row.goal_id,
            taskId: row.id,
            actionId: this.getTask(row.id)?.action.id ?? null,
            event: 'approval_expired',
            reason: 'approval_expired',
            status: next,
            happenedAt: now,
            resultCount: null,
            verifiedCount: null
          })
        }
        this.insertAudit({
          goalId: row.goal_id,
          taskId: row.id,
          actionId: this.getTask(row.id)?.action.id ?? null,
          event: next === 'outcome_unknown' ? 'outcome_unknown' : 'task_cancelled',
          reason: 'crash_recovery',
          status: next,
          happenedAt: now,
          resultCount: null,
          verifiedCount: null
        })
      }
    })
  }

  private tasksForGoal(goalId: string): TaskRecord[] {
    const rows = this.database.connection.prepare('SELECT id FROM goal_tasks WHERE goal_id = ? ORDER BY created_at, id').all(goalId) as unknown as Array<{ id: string }>
    return rows.flatMap(({ id }) => {
      const task = this.getTask(id)
      return task ? [task] : []
    })
  }

  private auditForGoal(goalId: string): GoalAuditRecord[] {
    const rows = this.database.connection.prepare('SELECT * FROM goal_audit WHERE goal_id = ? ORDER BY seq').all(goalId) as unknown as AuditRow[]
    return rows.map(mapAudit)
  }

  private getTaskRow(taskId: string): TaskRow | null {
    const row = this.database.connection.prepare(`
      SELECT
        t.id, t.goal_id, t.status, t.created_at, t.updated_at,
        a.id AS action_id, a.tool_id, a.tool_version, a.parameters_json, a.parameters_hash,
        a.resource_scope, a.risk, a.status AS action_status, a.planned_at,
        a.approval_expires_at, a.started_at, a.completed_at, a.idempotency_key,
        a.result_count, a.verified_count, a.verification_status, a.verification_at
      FROM goal_tasks t JOIN goal_actions a ON a.task_id = t.id WHERE t.id = ?
    `).get(taskId) as unknown as TaskRow | undefined
    return row ?? null
  }

  private updateStatus(taskId: string, previous: TaskStatus, next: TaskStatus, updatedAt: string, clearApproval: boolean): void {
    const taskUpdate = this.database.connection.prepare(`
      UPDATE goal_tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?
    `).run(next, updatedAt, taskId, previous)
    const actionUpdate = this.database.connection.prepare(`
      UPDATE goal_actions SET status = ?, approval_expires_at = CASE WHEN ? THEN NULL ELSE approval_expires_at END
      WHERE task_id = ? AND status = ?
    `).run(next, clearApproval ? 1 : 0, taskId, previous)
    if (taskUpdate.changes !== 1 || actionUpdate.changes !== 1) throw new ApplicationError('CONFLICT')
  }

  private approvalExists(taskId: string): boolean {
    const row = this.database.connection.prepare('SELECT 1 AS found FROM goal_approvals WHERE task_id = ?').get(taskId)
    return row !== undefined
  }

  private expectedParametersHash(): string {
    return '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
  }

  private insertAudit(audit: GoalAuditDraft): void {
    this.database.connection.prepare(`
      INSERT INTO goal_audit(goal_id, task_id, action_id, event, reason, status, happened_at, result_count, verified_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      audit.goalId,
      audit.taskId,
      audit.actionId,
      audit.event,
      audit.reason,
      audit.status,
      audit.happenedAt,
      audit.resultCount,
      audit.verifiedCount
    )
  }
}

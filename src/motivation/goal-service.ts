import { createHash, randomUUID } from 'node:crypto'
import type { GoalCreateRequest } from '../shared/contracts'
import { ApplicationError } from '../shared/errors'
import type { GoalApprovalRecord, GoalAuditDraft, GoalStore, StoredGoalAction } from './goal-store'
import { ToolRegistry, type ReadOnlyToolAdapter } from './tool-registry'
import { MemoryCountTool } from './tool-registry'
import type { MemoryService } from '../memory/memory-service'
import {
  canCancelTask,
  canPrepareAnotherTask,
  GOAL_ACTION_TIMEOUT_MS,
  GOAL_APPROVAL_TTL_MS,
  GOAL_DEFAULT_CONSTRAINTS,
  GOAL_SOURCE_CATEGORY,
  GOAL_SUCCESS_CRITERION,
  MAX_PENDING_GOAL_TASKS,
  MEMORY_COUNT_RESOURCE_SCOPE,
  MEMORY_COUNT_TOOL_ID,
  MEMORY_COUNT_TOOL_VERSION,
  SUPPORTED_GOAL_INTENT,
  validateGoalText,
  type ApprovalChallenge,
  type GoalListItem,
  type GoalRecord,
  type TaskRecord,
  type TaskStatus,
  type VerificationStatus
} from './goals'
import { isValidCount } from './goals'

export type ApprovalGate = (challenge: ApprovalChallenge) => Promise<boolean>

export interface GoalReminderLifecycle {
  cancelForGoal(goalId: string, reason: 'goal_inactive' | 'goal_deleted'): void
}

export interface GoalServiceOptions {
  approvalGate?: ApprovalGate
  clock?: () => string
  makeId?: () => string
  registry?: ToolRegistry
  actionTimeoutMs?: number
  approvalTtlMs?: number
  maxPendingTasks?: number
  reminderLifecycle?: GoalReminderLifecycle
}

interface ActionOutcome {
  status: Exclude<TaskStatus, 'queued' | 'awaiting_approval' | 'running' | 'cancelled'>
  resultCount: number | null
  verifiedCount: number | null
  verificationStatus: VerificationStatus
  event: GoalAuditDraft['event']
  reason: GoalAuditDraft['reason']
}

function parametersHash(parametersJson: string): string {
  return createHash('sha256').update(parametersJson, 'utf8').digest('hex')
}

function parseEmptyParameters(value: string): Record<string, never> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ApplicationError('FORBIDDEN')
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (Object.getPrototypeOf(parsed) !== Object.prototype && Object.getPrototypeOf(parsed) !== null) ||
    Reflect.ownKeys(parsed).length !== 0
  ) {
    throw new ApplicationError('FORBIDDEN')
  }
  return parsed as Record<string, never>
}

function validCountResponse(value: unknown): value is { count: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 1 || keys[0] !== 'count') return false
  return isValidCount((value as { count?: unknown }).count)
}

export class GoalService {
  private readonly controllers = new Map<string, AbortController>()
  private readonly approvalGate: ApprovalGate
  private readonly clock: () => string
  private readonly makeId: () => string
  private readonly registry: ToolRegistry
  private readonly actionTimeoutMs: number
  private readonly approvalTtlMs: number
  private readonly maxPendingTasks: number
  private readonly reminderLifecycle: GoalReminderLifecycle | undefined

  constructor(
    private readonly repository: GoalStore,
    private readonly memories: MemoryService,
    options: GoalServiceOptions = {}
  ) {
    this.approvalGate = options.approvalGate ?? (async () => false)
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.makeId = options.makeId ?? (() => randomUUID())
    this.registry = options.registry ?? new ToolRegistry(new MemoryCountTool(memories))
    this.actionTimeoutMs = options.actionTimeoutMs ?? GOAL_ACTION_TIMEOUT_MS
    this.approvalTtlMs = options.approvalTtlMs ?? GOAL_APPROVAL_TTL_MS
    this.maxPendingTasks = options.maxPendingTasks ?? MAX_PENDING_GOAL_TASKS
    this.reminderLifecycle = options.reminderLifecycle
    if (!Number.isSafeInteger(this.actionTimeoutMs) || this.actionTimeoutMs < 1) throw new Error('Invalid action timeout.')
    if (!Number.isSafeInteger(this.approvalTtlMs) || this.approvalTtlMs < 1) throw new Error('Invalid approval lifetime.')
    if (!Number.isSafeInteger(this.maxPendingTasks) || this.maxPendingTasks < 1) throw new Error('Invalid pending-task limit.')
    this.repository.recoverInterrupted(this.timestamp())
  }

  list(): GoalListItem[] {
    return this.repository.list().map((item) => ({
      ...item,
      tasks: item.tasks.map((task) => ({
        ...task,
        approvalChallenge: task.status === 'awaiting_approval' ? this.buildChallenge(task) : null
      }))
    }))
  }

  create(request: GoalCreateRequest): GoalRecord {
    validateGoalText(request.intent, 800, 'Goal intent')
    validateGoalText(request.constraints, 2000, 'Goal constraints')
    if (
      request.intent.trim() !== SUPPORTED_GOAL_INTENT ||
      request.successCriterion !== GOAL_SUCCESS_CRITERION ||
      request.constraints.trim() !== GOAL_DEFAULT_CONSTRAINTS ||
      request.acceptedBoundary !== true
    ) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const now = this.timestamp()
    const goal: GoalRecord = {
      id: this.makeId(),
      intent: request.intent.trim(),
      successCriterion: GOAL_SUCCESS_CRITERION,
      constraints: request.constraints.trim(),
      sourceCategory: GOAL_SOURCE_CATEGORY,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
    this.repository.createGoal(goal, this.audit(goal.id, null, null, 'goal_created', 'user_created', 'active', now))
    return goal
  }

  prepare(goalId: string, acknowledgeUnknown: boolean): TaskRecord {
    const goal = this.repository.getGoal(goalId)
    if (!goal) throw new ApplicationError('NOT_FOUND')
    if (goal.status !== 'active') throw new ApplicationError('CONFLICT')
    const previousStatuses = this.repository.previousTaskStatuses(goalId)
    if (!canPrepareAnotherTask(previousStatuses, acknowledgeUnknown)) throw new ApplicationError('CONFLICT')
    const now = this.timestamp()
    const actionId = this.makeId()
    const task: TaskRecord = {
      id: this.makeId(),
      goalId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      action: {
        id: actionId,
        toolId: MEMORY_COUNT_TOOL_ID,
        toolVersion: MEMORY_COUNT_TOOL_VERSION,
        parametersHash: parametersHash('{}'),
        resourceScope: MEMORY_COUNT_RESOURCE_SCOPE,
        risk: 'read-only',
        status: 'queued',
        plannedAt: now,
        approvalExpiresAt: null,
        startedAt: null,
        completedAt: null,
        idempotencyKey: this.makeId(),
        resultCount: null,
        verifiedCount: null,
        verificationStatus: 'not_run',
        verificationAt: null
      },
      approvalChallenge: null
    }
    const audits: GoalAuditDraft[] = []
    if (previousStatuses.includes('outcome_unknown') && acknowledgeUnknown) {
      audits.push(this.audit(goalId, null, null, 'unknown_outcome_acknowledged', 'user_acknowledged_unknown', 'outcome_unknown', now))
    }
    audits.push(this.audit(goalId, task.id, actionId, 'task_queued', 'user_prepared', 'queued', now))
    this.repository.createTask(task, '{}', audits, this.maxPendingTasks)
    return task
  }

  requestApproval(taskId: string): ApprovalChallenge {
    const task = this.repository.getTask(taskId)
    if (!task) throw new ApplicationError('NOT_FOUND')
    if (task.status !== 'queued') throw new ApplicationError('CONFLICT')
    const goal = this.repository.getGoal(task.goalId)
    if (!goal || goal.status !== 'active') throw new ApplicationError('CONFLICT')
    const now = this.timestamp()
    const expiresAt = new Date(Date.parse(now) + this.approvalTtlMs).toISOString()
    const updated = this.repository.requestApproval(
      taskId,
      expiresAt,
      now,
      this.audit(goal.id, task.id, task.action.id, 'approval_requested', 'user_requested_approval', 'awaiting_approval', now)
    )
    return this.buildChallenge(updated)
  }

  rejectApproval(taskId: string): TaskRecord {
    const task = this.repository.getTask(taskId)
    if (!task) throw new ApplicationError('NOT_FOUND')
    if (task.status !== 'awaiting_approval') throw new ApplicationError('CONFLICT')
    const now = this.timestamp()
    if (task.action.approvalExpiresAt && task.action.approvalExpiresAt <= now) {
      return this.repository.rejectApproval(taskId, now, true)
    }
    return this.repository.rejectApproval(taskId, now, false)
  }

  async approveAndExecute(taskId: string): Promise<TaskRecord> {
    const task = this.repository.getTask(taskId)
    if (!task) throw new ApplicationError('NOT_FOUND')
    const goal = this.repository.getGoal(task.goalId)
    if (!goal || goal.status !== 'active' || task.status !== 'awaiting_approval') throw new ApplicationError('CONFLICT')
    const storedAction = this.repository.getStoredAction(taskId)
    if (!storedAction) throw new ApplicationError('NOT_FOUND')
    const tool = this.resolveTool(storedAction)
    const challenge = this.buildChallenge(task)
    if (!(await this.approvalGate(challenge))) {
      const rejectedAt = this.timestamp()
      const expired = Boolean(task.action.approvalExpiresAt && task.action.approvalExpiresAt <= rejectedAt)
      return this.repository.rejectApproval(taskId, rejectedAt, expired)
    }
    const approvedAt = this.timestamp()
    const expiresAt = task.action.approvalExpiresAt
    if (!expiresAt || expiresAt <= approvedAt) return this.repository.rejectApproval(taskId, approvedAt, true)
    const approval: GoalApprovalRecord = {
      id: this.makeId(),
      taskId,
      actionId: storedAction.id,
      toolId: storedAction.toolId,
      toolVersion: storedAction.toolVersion,
      parametersHash: storedAction.parametersHash,
      resourceScope: storedAction.resourceScope,
      risk: storedAction.risk,
      expiresAt,
      approvedAt,
      consumedAt: approvedAt
    }
    const running = this.repository.startApprovedTask(approval, approvedAt, [
      this.audit(goal.id, task.id, storedAction.id, 'approval_consumed', 'user_approved', 'running', approvedAt),
      this.audit(goal.id, task.id, storedAction.id, 'action_started', 'user_approved', 'running', approvedAt)
    ])
    if (running.status !== 'running') return running
    const controller = new AbortController()
    this.controllers.set(taskId, controller)
    try {
      const outcome = await this.runTool(tool, storedAction.parametersJson, controller)
      const completedAt = this.timestamp()
      const persisted = this.repository.completeRunningTask(
        taskId,
        outcome.status,
        completedAt,
        outcome.resultCount,
        outcome.verifiedCount,
        outcome.verificationStatus,
        this.audit(goal.id, task.id, storedAction.id, outcome.event, outcome.reason, outcome.status, completedAt, outcome.resultCount, outcome.verifiedCount)
      )
      if (this.repository.getGoal(goal.id)?.status !== 'active') {
        this.reminderLifecycle?.cancelForGoal(goal.id, 'goal_inactive')
      }
      return persisted ?? this.repository.getTask(taskId) ?? running
    } finally {
      this.controllers.delete(taskId)
    }
  }

  cancelTask(taskId: string): TaskRecord {
    const now = this.timestamp()
    const result = this.repository.cancelTask(taskId, now)
    if (result.shouldTerminate) this.controllers.get(taskId)?.abort()
    return result.task
  }

  stop(goalId: string): GoalRecord {
    const now = this.timestamp()
    const goal = this.repository.getGoal(goalId)
    if (!goal) throw new ApplicationError('NOT_FOUND')
    const result = this.repository.stopGoal(goalId, now)
    for (const taskId of result.taskIds) this.controllers.get(taskId)?.abort()
    const stopped = this.repository.getGoal(goalId)
    if (!stopped) throw new ApplicationError('NOT_FOUND')
    this.reminderLifecycle?.cancelForGoal(goalId, 'goal_inactive')
    return stopped
  }

  delete(goalId: string): void {
    const goal = this.repository.getGoal(goalId)
    if (!goal) throw new ApplicationError('NOT_FOUND')
    for (const taskId of this.repository.pendingTaskIds(goalId)) this.controllers.get(taskId)?.abort()
    if (!this.repository.deleteGoal(goalId)) throw new ApplicationError('NOT_FOUND')
    this.reminderLifecycle?.cancelForGoal(goalId, 'goal_deleted')
  }

  private resolveTool(action: StoredGoalAction): ReadOnlyToolAdapter {
    const tool = this.registry.get(action.toolId)
    if (!tool || action.parametersJson !== '{}' || action.parametersHash !== parametersHash(action.parametersJson)) {
      throw new ApplicationError('FORBIDDEN')
    }
    const definition = tool.definition
    if (
      definition.id !== action.toolId ||
      definition.version !== action.toolVersion ||
      definition.allowedResources.length !== 1 ||
      definition.allowedResources[0] !== action.resourceScope ||
      definition.risk !== action.risk ||
      definition.sideEffect !== 'none'
    ) {
      throw new ApplicationError('FORBIDDEN')
    }
    parseEmptyParameters(action.parametersJson)
    return tool
  }

  private buildChallenge(task: TaskRecord): ApprovalChallenge {
    const goal = this.repository.getGoal(task.goalId)
    const action = this.repository.getStoredAction(task.id)
    const tool = action ? this.resolveTool(action) : null
    const expiresAt = task.action.approvalExpiresAt
    if (!goal || !action || !tool || !expiresAt) throw new ApplicationError('CONFLICT')
    return {
      taskId: task.id,
      goalIntent: goal.intent,
      goalConstraints: goal.constraints,
      toolId: action.toolId,
      toolVersion: action.toolVersion,
      parameters: parseEmptyParameters(action.parametersJson),
      resourceScope: action.resourceScope,
      risk: action.risk,
      expiresAt,
      singleUse: true,
      expectedEffect: '读取本地数据库中的当前有效记忆数量，不读取或显示记忆正文。'
    }
  }

  private async runTool(
    tool: ReadOnlyToolAdapter,
    parametersJson: string,
    controller: AbortController
  ): Promise<ActionOutcome> {
    const parameters = parseEmptyParameters(parametersJson)
    const work = this.evaluate(tool, parameters, controller.signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ActionOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve({
          status: 'outcome_unknown',
          resultCount: null,
          verifiedCount: null,
          verificationStatus: 'not_run',
          event: 'outcome_unknown',
          reason: 'timeout'
        })
      }, this.actionTimeoutMs)
    })
    try {
      return await Promise.race([work, timeout])
    } catch {
      return {
        status: controller.signal.aborted ? 'outcome_unknown' : 'failed',
        resultCount: null,
        verifiedCount: null,
        verificationStatus: 'not_run',
        event: controller.signal.aborted ? 'outcome_unknown' : 'action_failed',
        reason: controller.signal.aborted ? 'timeout' : 'tool_error'
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async evaluate(
    tool: ReadOnlyToolAdapter,
    parameters: Record<string, never>,
    signal: AbortSignal
  ): Promise<ActionOutcome> {
    let result: unknown
    try {
      result = await tool.execute(parameters, signal)
    } catch {
      return {
        status: signal.aborted ? 'outcome_unknown' : 'failed',
        resultCount: null,
        verifiedCount: null,
        verificationStatus: 'not_run',
        event: signal.aborted ? 'outcome_unknown' : 'action_failed',
        reason: signal.aborted ? 'timeout' : 'tool_error'
      }
    }
    if (signal.aborted) {
      return {
        status: 'outcome_unknown',
        resultCount: null,
        verifiedCount: null,
        verificationStatus: 'not_run',
        event: 'outcome_unknown',
        reason: 'timeout'
      }
    }
    if (!validCountResponse(result)) {
      return { status: 'failed', resultCount: null, verifiedCount: null, verificationStatus: 'not_run', event: 'action_failed', reason: 'tool_error' }
    }
    let verified: unknown
    try {
      verified = await tool.verify(parameters, signal)
    } catch {
      return { status: 'verification_failed', resultCount: result.count, verifiedCount: null, verificationStatus: 'mismatch', event: 'verification_failed', reason: 'verification_mismatch' }
    }
    if (signal.aborted) {
      return { status: 'outcome_unknown', resultCount: result.count, verifiedCount: null, verificationStatus: 'not_run', event: 'outcome_unknown', reason: 'timeout' }
    }
    if (!validCountResponse(verified)) {
      return { status: 'verification_failed', resultCount: result.count, verifiedCount: null, verificationStatus: 'mismatch', event: 'verification_failed', reason: 'verification_mismatch' }
    }
    if (result.count !== verified.count) {
      return { status: 'verification_failed', resultCount: result.count, verifiedCount: verified.count, verificationStatus: 'mismatch', event: 'verification_failed', reason: 'verification_mismatch' }
    }
    return { status: 'succeeded', resultCount: result.count, verifiedCount: verified.count, verificationStatus: 'matched', event: 'action_succeeded', reason: 'user_approved' }
  }

  private audit(
    goalId: string,
    taskId: string | null,
    actionId: string | null,
    event: GoalAuditDraft['event'],
    reason: GoalAuditDraft['reason'],
    status: GoalAuditDraft['status'],
    happenedAt: string,
    resultCount: number | null = null,
    verifiedCount: number | null = null
  ): GoalAuditDraft {
    return { goalId, taskId, actionId, event, reason, status, happenedAt, resultCount, verifiedCount }
  }

  private timestamp(): string {
    const value = this.clock()
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !value.endsWith('Z')) {
      throw new ApplicationError('STORAGE_ERROR')
    }
    return new Date(value).toISOString()
  }
}

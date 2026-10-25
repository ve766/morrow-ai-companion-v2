export const MEMORY_COUNT_TOOL_ID = 'memory.count_active' as const
export const MEMORY_COUNT_TOOL_VERSION = '1' as const
export const MEMORY_COUNT_RESOURCE_SCOPE = 'memory.active_count' as const
export const GOAL_SUCCESS_CRITERION = 'active_memory_count_matches_database' as const
export const GOAL_ACTION_TIMEOUT_MS = 5000
export const GOAL_APPROVAL_TTL_MS = 120000
export const MAX_PENDING_GOAL_TASKS = 10
export const GOAL_SOURCE_CATEGORY = 'user_explicit_input' as const
export const SUPPORTED_GOAL_INTENT = '核对本机当前有效记忆数量' as const
export const GOAL_DEFAULT_CONSTRAINTS = '只读取当前有效记忆数量，不修改或删除数据，不访问网络。' as const

export const MEMORY_COUNT_TOOL_DEFINITION = Object.freeze({
  id: MEMORY_COUNT_TOOL_ID,
  version: MEMORY_COUNT_TOOL_VERSION,
  requestSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  responseSchema: {
    type: 'object',
    properties: { count: { type: 'integer', minimum: 0 } },
    required: ['count'],
    additionalProperties: false
  },
  allowedResources: [MEMORY_COUNT_RESOURCE_SCOPE],
  risk: 'read-only',
  timeoutMs: GOAL_ACTION_TIMEOUT_MS,
  sideEffect: 'none'
} as const)

export type GoalStatus = 'active' | 'completed' | 'cancelled'
export type TaskStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'verification_failed'
  | 'outcome_unknown'
export type ActionStatus = TaskStatus
export type ApprovalRisk = 'read-only'
export type VerificationStatus = 'not_run' | 'matched' | 'mismatch'
export type GoalAuditEvent =
  | 'unknown_outcome_acknowledged'
  | 'goal_created'
  | 'goal_stopped'
  | 'task_queued'
  | 'approval_requested'
  | 'approval_consumed'
  | 'approval_rejected'
  | 'approval_expired'
  | 'task_cancelled'
  | 'action_started'
  | 'action_succeeded'
  | 'action_failed'
  | 'verification_failed'
  | 'outcome_unknown'
export type GoalAuditReason =
  | 'user_acknowledged_unknown'
  | 'policy_denied'
  | 'user_created'
  | 'user_prepared'
  | 'user_requested_approval'
  | 'user_approved'
  | 'user_rejected'
  | 'approval_expired'
  | 'user_cancelled'
  | 'user_stopped_goal'
  | 'timeout'
  | 'tool_error'
  | 'verification_mismatch'
  | 'crash_recovery'

export interface GoalRecord {
  id: string
  intent: string
  successCriterion: typeof GOAL_SUCCESS_CRITERION
  constraints: string
  sourceCategory: typeof GOAL_SOURCE_CATEGORY
  status: GoalStatus
  createdAt: string
  updatedAt: string
}

export interface GoalActionRecord {
  id: string
  toolId: typeof MEMORY_COUNT_TOOL_ID
  toolVersion: typeof MEMORY_COUNT_TOOL_VERSION
  parametersHash: string
  resourceScope: typeof MEMORY_COUNT_RESOURCE_SCOPE
  risk: ApprovalRisk
  status: ActionStatus
  plannedAt: string
  approvalExpiresAt: string | null
  startedAt: string | null
  completedAt: string | null
  idempotencyKey: string
  resultCount: number | null
  verifiedCount: number | null
  verificationStatus: VerificationStatus
  verificationAt: string | null
}

export interface TaskRecord {
  id: string
  goalId: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  action: GoalActionRecord
  approvalChallenge: ApprovalChallenge | null
}

export interface GoalListItem {
  goal: GoalRecord
  tasks: TaskRecord[]
  audit: GoalAuditRecord[]
}

export interface GoalAuditRecord {
  seq: number
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

export interface ApprovalChallenge {
  taskId: string
  goalIntent: string
  goalConstraints: string
  toolId: typeof MEMORY_COUNT_TOOL_ID
  toolVersion: typeof MEMORY_COUNT_TOOL_VERSION
  parameters: Record<string, never>
  resourceScope: typeof MEMORY_COUNT_RESOURCE_SCOPE
  risk: ApprovalRisk
  expiresAt: string
  singleUse: true
  expectedEffect: string
}

export class GoalValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoalValidationError'
  }
}

export class GoalTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoalTransitionError'
  }
}

export class ToolExecutionError extends Error {
  readonly outcomeUnknown: boolean

  constructor(outcomeUnknown: boolean) {
    super(outcomeUnknown ? 'Tool outcome is unknown.' : 'Tool execution failed.')
    this.name = 'ToolExecutionError'
    this.outcomeUnknown = outcomeUnknown
  }
}

export function validateGoalText(value: unknown, maxLength: number, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    value.includes('\u0000') ||
    /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new GoalValidationError(`${field} is invalid.`)
  }
}

export function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === 'queued') return to === 'awaiting_approval' || to === 'cancelled'
  if (from === 'awaiting_approval') return to === 'running' || to === 'cancelled'
  if (from === 'running') {
    return to === 'succeeded' || to === 'failed' || to === 'cancelled' || to === 'verification_failed' || to === 'outcome_unknown'
  }
  return false
}

export function canCancelTask(status: TaskStatus): boolean {
  return status === 'queued' || status === 'awaiting_approval' || status === 'running'
}

export function canPrepareAnotherTask(previousStatuses: readonly TaskStatus[], acknowledgeUnknown: boolean): boolean {
  if (previousStatuses.some((status) => status === 'queued' || status === 'awaiting_approval' || status === 'running')) return false
  if (previousStatuses.includes('outcome_unknown') && !acknowledgeUnknown) return false
  return true
}

export function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

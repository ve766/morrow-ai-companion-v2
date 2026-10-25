import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { GoalCreateRequest } from '../shared/contracts'
import {
  GOAL_DEFAULT_CONSTRAINTS,
  GOAL_SUCCESS_CRITERION,
  MEMORY_COUNT_RESOURCE_SCOPE,
  MEMORY_COUNT_TOOL_DEFINITION,
  MEMORY_COUNT_TOOL_ID,
  MEMORY_COUNT_TOOL_VERSION,
  SUPPORTED_GOAL_INTENT,
  type ApprovalChallenge,
  type TaskStatus
} from './goals'
import { ApplicationError } from '../shared/errors'
import { GoalService, type GoalReminderLifecycle } from './goal-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteGoalRepository } from '../persistence/goal-repository'
import type { GoalAuditDraft, GoalApprovalRecord } from './goal-store'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemoryCountTool, ToolRegistry, type ReadOnlyToolAdapter } from './tool-registry'

const now = '2026-10-22T02:00:00.000Z'
const request: GoalCreateRequest = {
  intent: SUPPORTED_GOAL_INTENT,
  successCriterion: GOAL_SUCCESS_CRITERION,
  constraints: GOAL_DEFAULT_CONSTRAINTS,
  acceptedBoundary: true
}

function fixedTool(execute: ReadOnlyToolAdapter['execute'], verify: ReadOnlyToolAdapter['verify']): ReadOnlyToolAdapter {
  return { definition: MEMORY_COUNT_TOOL_DEFINITION, execute, verify }
}

function createHarness(options: {
  approvalGate?: (challenge: ApprovalChallenge) => Promise<boolean>
  tool?: ReadOnlyToolAdapter
  actionTimeoutMs?: number
  clock?: () => string
  reminderLifecycle?: GoalReminderLifecycle
} = {}) {
  const database = SqliteDatabase.open(':memory:')
  const memories = new MemoryService(new SqliteMemoryRepository(database), () => now, () => randomUUID())
  const repository = new SqliteGoalRepository(database)
  const tool = options.tool ?? new MemoryCountTool(memories)
  const service = new GoalService(repository, memories, {
    approvalGate: options.approvalGate ?? (async () => true),
    clock: options.clock ?? (() => now),
    registry: new ToolRegistry(tool),
    ...(options.actionTimeoutMs === undefined ? {} : { actionTimeoutMs: options.actionTimeoutMs }),
    ...(options.reminderLifecycle === undefined ? {} : { reminderLifecycle: options.reminderLifecycle })
  })
  return { database, memories, repository, service, close: () => database.close() }
}

function startGoal(service: GoalService) {
  const goal = service.create(request)
  const task = service.prepare(goal.id, false)
  return { goal, task }
}

describe('M2 bounded goal, authorization, execution and recovery', () => {
  it('requires a user-authored supported goal and a success criterion before planning', () => {
    const { service, close } = createHarness()
    try {
      expect(() => service.create({ ...request, intent: 'execute a shell command' })).toThrow(ApplicationError)
      expect(() => service.create({ ...request, successCriterion: 'invented' as never })).toThrow(ApplicationError)
      expect(() => service.create({ ...request, acceptedBoundary: false } as unknown as GoalCreateRequest)).toThrow(ApplicationError)
      expect(service.list()).toEqual([])
    } finally {
      close()
    }
  })

  it('stores a goal and queued action, requests a scope-bound approval, executes the allowlisted read-only tool and verifies independently', async () => {
    const approvalGate = vi.fn(async () => true)
    const { memories, service, repository, close } = createHarness({ approvalGate })
    try {
      memories.create('A private memory body that the count tool must not read or display.')
      const { goal, task } = startGoal(service)
      expect(task.status).toBe('queued')
      expect(task.action).toMatchObject({
        toolId: MEMORY_COUNT_TOOL_ID,
        toolVersion: MEMORY_COUNT_TOOL_VERSION,
        resourceScope: MEMORY_COUNT_RESOURCE_SCOPE,
        risk: 'read-only',
        verificationStatus: 'not_run'
      })
      expect(task.action.parametersHash).toMatch(/^[0-9a-f]{64}$/u)

      const challenge = service.requestApproval(task.id)
      expect(challenge).toMatchObject({
        taskId: task.id,
        goalIntent: SUPPORTED_GOAL_INTENT,
        goalConstraints: GOAL_DEFAULT_CONSTRAINTS,
        toolId: MEMORY_COUNT_TOOL_ID,
        toolVersion: MEMORY_COUNT_TOOL_VERSION,
        parameters: {},
        resourceScope: MEMORY_COUNT_RESOURCE_SCOPE,
        risk: 'read-only',
        singleUse: true,
        expectedEffect: '读取本地数据库中的当前有效记忆数量，不读取或显示记忆正文。'
      })
      expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(Date.parse(now))
      expect((await service.approveAndExecute(task.id)).status).toBe('succeeded')
      const result = service.list()[0]!
      expect(result.goal.status).toBe('completed')
      expect(result.tasks[0]!.action).toMatchObject({
        resultCount: 1,
        verifiedCount: 1,
        verificationStatus: 'matched'
      })
      expect(result.audit.map((item) => item.event)).toEqual([
        'goal_created', 'task_queued', 'approval_requested', 'approval_consumed', 'action_started', 'action_succeeded'
      ])
      expect(result.audit.every((item) => item.resultCount === null || item.resultCount === 1)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('private memory body')
      expect(repository.getStoredAction(task.id)?.parametersJson).toBe('{}')
      expect(approvalGate).toHaveBeenCalledTimes(1)
      await expect(service.approveAndExecute(task.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    } finally {
      close()
    }
  })

  it('records rejection and performs no tool call when approval is declined', async () => {
    const execute = vi.fn(() => ({ count: 0 }))
    const verify = vi.fn(() => ({ count: 0 }))
    const { service, close } = createHarness({
      approvalGate: async () => false,
      tool: fixedTool(execute, verify)
    })
    try {
      const { task } = startGoal(service)
      service.requestApproval(task.id)
      expect((await service.approveAndExecute(task.id)).status).toBe('cancelled')
      expect(execute).not.toHaveBeenCalled()
      expect(verify).not.toHaveBeenCalled()
      expect(service.list()[0]!.audit.map((event) => event.event)).toContain('approval_rejected')
    } finally {
      close()
    }
  })

  it('does not execute altered parameters, tool IDs, resource scopes or approval records', async () => {
    for (const alteration of [
      "UPDATE goal_actions SET parameters_hash = ? WHERE task_id = ?",
      "UPDATE goal_actions SET tool_id = ? WHERE task_id = ?",
      "UPDATE goal_actions SET resource_scope = ? WHERE task_id = ?"
    ]) {
      const execute = vi.fn(() => ({ count: 0 }))
      const { service, repository, database, close } = createHarness({ tool: fixedTool(execute, () => ({ count: 0 })) })
      try {
        const { task } = startGoal(service)
        service.requestApproval(task.id)
        database.connection.exec('PRAGMA ignore_check_constraints = ON')
        const value = alteration.includes('parameters_hash') ? '0'.repeat(64)
          : alteration.includes('tool_id') ? 'shell' : 'filesystem:any'
        database.connection.prepare(alteration).run(value, task.id)
        await expect(service.approveAndExecute(task.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
        expect(execute).not.toHaveBeenCalled()
        expect(repository.getTask(task.id)?.status).toBe('awaiting_approval')
      } finally {
        close()
      }
    }
  })

  it('expires an approval before any tool side effect', async () => {
    let clock = now
    const execute = vi.fn(() => ({ count: 0 }))
    const { database, memories, service, repository, close } = createHarness({
      tool: fixedTool(execute, () => ({ count: 0 })),
      clock: () => clock,
      approvalGate: async () => {
        clock = '2026-10-22T02:02:01.000Z'
        return true
      }
    })
    try {
      const { goal, task } = startGoal(service)
      service.requestApproval(task.id)
      expect((await service.approveAndExecute(task.id)).status).toBe('cancelled')
      expect(execute).not.toHaveBeenCalled()
      expect(repository.getTask(task.id)?.status).toBe('cancelled')
      expect(service.list()[0]!.audit.map((event) => event.event)).toContain('approval_expired')
      expect(database.connection.prepare('SELECT count(*) AS count FROM memories').get()).toEqual({ count: 0 })
      expect(repository.getGoal(goal.id)?.status).toBe('active')
    } finally {
      close()
    }
  })

  it('marks a running action outcome unknown on cancellation and requires explicit acknowledgement before a new attempt', async () => {
    let started!: () => void
    const actionStarted = new Promise<void>((resolve) => { started = resolve })
    const tool = fixedTool(
      (_parameters, signal) => new Promise((resolve) => {
        started()
        signal.addEventListener('abort', () => resolve({ count: 0 }), { once: true })
      }),
      () => ({ count: 0 })
    )
    const { service, close } = createHarness({ tool })
    try {
      const { goal, task } = startGoal(service)
      service.requestApproval(task.id)
      const execution = service.approveAndExecute(task.id)
      await actionStarted
      expect(service.cancelTask(task.id).status).toBe('outcome_unknown')
      expect((await execution).status).toBe('outcome_unknown')
      expect(() => service.prepare(goal.id, false)).toThrow(ApplicationError)
      const retry = service.prepare(goal.id, true)
      expect(retry.status).toBe('queued')
      expect(service.list()[0]!.audit.map((event) => event.event)).toContain('unknown_outcome_acknowledged')
    } finally {
      close()
    }
  })

  it('uses a real timeout, aborts the tool, persists outcome unknown, and never blindly replays it', async () => {
    let aborted = false
    const tool = fixedTool(
      (_parameters, signal) => new Promise(() => {
        signal.addEventListener('abort', () => { aborted = true }, { once: true })
      }),
      () => ({ count: 0 })
    )
    const { service, close } = createHarness({ tool, actionTimeoutMs: 15 })
    try {
      const { goal, task } = startGoal(service)
      service.requestApproval(task.id)
      expect((await service.approveAndExecute(task.id)).status).toBe('outcome_unknown')
      expect(aborted).toBe(true)
      expect(() => service.prepare(goal.id, false)).toThrow(ApplicationError)
      expect(service.list()[0]!.tasks[0]!.status).toBe('outcome_unknown')
    } finally {
      close()
    }
  })

  it('marks in-flight work unknown after restart and recovers queued work as cancelled', () => {
    const { service, repository, memories, database, close } = createHarness()
    try {
      const { goal, task } = startGoal(service)
      const challenge = service.requestApproval(task.id)
      const action = repository.getStoredAction(task.id)!
      const approval: GoalApprovalRecord = {
        id: randomUUID(),
        taskId: task.id,
        actionId: action.id,
        toolId: action.toolId,
        toolVersion: action.toolVersion,
        parametersHash: action.parametersHash,
        resourceScope: action.resourceScope,
        risk: action.risk,
        expiresAt: challenge.expiresAt,
        approvedAt: now,
        consumedAt: now
      }
      const audit: GoalAuditDraft = {
        goalId: goal.id,
        taskId: task.id,
        actionId: action.id,
        event: 'action_started',
        reason: 'user_approved',
        status: 'running',
        happenedAt: now,
        resultCount: null,
        verifiedCount: null
      }
      repository.startApprovedTask(approval, now, [audit])
      const queueGoal = service.create(request)
      const queued = service.prepare(queueGoal.id, false)
      const restarted = new GoalService(repository, memories, { clock: () => now })
      const statuses = restarted.list().flatMap((item) => item.tasks.map((record) => record.status)).sort()
      expect(statuses).toEqual(['cancelled', 'outcome_unknown'])
      expect(restarted.list().find((item) => item.goal.id === goal.id)?.audit.map((event) => event.event)).toContain('outcome_unknown')
      expect(restarted.list().find((item) => item.goal.id === queueGoal.id)?.tasks[0]?.id).toBe(queued.id)
      expect(database.connection.prepare('SELECT count(*) AS count FROM goal_approvals').get()).toEqual({ count: 1 })
    } finally {
      close()
    }
  })

  it('does not mark a mismatch or malformed tool response as success', async () => {
    for (const [result, verified, expected] of [
      [{ count: 2 }, { count: 1 }, 'verification_failed'],
      [{ count: 2, memoryText: 'private body' }, { count: 2 }, 'failed']
    ] as const) {
      const { service, close } = createHarness({
        tool: fixedTool(() => result, () => verified)
      })
      try {
        const { goal, task } = startGoal(service)
        service.requestApproval(task.id)
        expect((await service.approveAndExecute(task.id)).status).toBe(expected)
        expect(service.list()[0]!.goal.status).toBe('active')
        expect(service.list()[0]!.tasks[0]!.status).toBe(expected)
      } finally {
        close()
      }
    }
  })

  it('cancels linked reminders when an approved action completes its goal', async () => {
    const reminderLifecycle = { cancelForGoal: vi.fn() }
    const { service, close } = createHarness({ reminderLifecycle })
    try {
      const { goal, task } = startGoal(service)
      service.requestApproval(task.id)
      expect((await service.approveAndExecute(task.id)).status).toBe('succeeded')
      expect(reminderLifecycle.cancelForGoal).toHaveBeenCalledWith(goal.id, 'goal_inactive')
    } finally {
      close()
    }
  })

  it('stops and deletes goals while immediately cancelling linked reminders and cascading goal data', async () => {
    const reminderLifecycle = { cancelForGoal: vi.fn() }
    const { service, repository, database, close } = createHarness({ reminderLifecycle })
    try {
      const { goal, task } = startGoal(service)
      service.requestApproval(task.id)
      expect(service.stop(goal.id).status).toBe('cancelled')
      expect(repository.getTask(task.id)?.status).toBe('cancelled')
      expect(reminderLifecycle.cancelForGoal).toHaveBeenNthCalledWith(1, goal.id, 'goal_inactive')
      service.delete(goal.id)
      expect(reminderLifecycle.cancelForGoal).toHaveBeenNthCalledWith(2, goal.id, 'goal_deleted')
      expect(service.list()).toEqual([])
      for (const table of ['goals', 'goal_tasks', 'goal_actions', 'goal_approvals', 'goal_audit', 'reminders', 'reminder_decisions']) {
        expect(database.connection.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
      }
    } finally {
      close()
    }
  })

  it('does not ask an unregistered tool to execute', () => {
    const { service, repository, database, close } = createHarness()
    try {
      const { task } = startGoal(service)
      service.requestApproval(task.id)
      database.connection.exec('PRAGMA ignore_check_constraints = ON')
      database.connection.prepare('UPDATE goal_actions SET tool_id = ? WHERE task_id = ?').run('unknown', task.id)
      const action = repository.getStoredAction(task.id)
      expect(action?.toolId).toBe('unknown')
    } finally {
      close()
    }
  })
})

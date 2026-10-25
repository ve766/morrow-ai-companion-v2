import { describe, expect, it } from 'vitest'
import type { GoalActionRecord, GoalAuditRecord, TaskRecord } from './goals'
import { buildGoalEvidenceTimeline } from './goal-evidence'

const goalId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const actionId = '33333333-3333-4333-8333-333333333333'

function audit(overrides: Partial<GoalAuditRecord> & { seq: number; event: GoalAuditRecord['event'] }): GoalAuditRecord {
  return {
    seq: overrides.seq,
    event: overrides.event,
    goalId,
    taskId: overrides.taskId ?? (overrides.event === 'goal_created' || overrides.event === 'goal_stopped' ? null : taskId),
    actionId: overrides.actionId ?? null,
    reason: overrides.reason ?? 'user_created',
    status: overrides.status ?? 'active',
    happenedAt: overrides.happenedAt ?? '2026-10-25T00:00:00.000Z',
    resultCount: overrides.resultCount ?? null,
    verifiedCount: overrides.verifiedCount ?? null
  }
}

function action(overrides: Partial<GoalActionRecord> = {}): GoalActionRecord {
  return {
    id: actionId,
    toolId: 'memory.count_active',
    toolVersion: '1',
    parametersHash: 'a'.repeat(64),
    resourceScope: 'memory.active_count',
    risk: 'read-only',
    status: overrides.status ?? 'succeeded',
    plannedAt: '2026-10-25T00:00:00.000Z',
    approvalExpiresAt: null,
    startedAt: overrides.startedAt ?? '2026-10-25T00:01:00.000Z',
    completedAt: overrides.completedAt ?? '2026-10-25T00:02:00.000Z',
    idempotencyKey: 'idem-1',
    resultCount: overrides.resultCount ?? 3,
    verifiedCount: overrides.verifiedCount ?? 3,
    verificationStatus: overrides.verificationStatus ?? 'matched',
    verificationAt: overrides.verificationAt ?? '2026-10-25T00:02:01.000Z'
  }
}

function task(overrides: Partial<GoalActionRecord> = {}): TaskRecord {
  return {
    id: taskId,
    goalId,
    status: overrides.status ?? 'succeeded',
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:02:00.000Z',
    action: action(overrides),
    approvalChallenge: null
  }
}

describe('goal evidence timeline builder', () => {
  it('orders events by audit sequence, keeps the sequence stable, and does not mutate inputs', () => {
    const input = [
      audit({ seq: 3, event: 'action_succeeded', resultCount: 3, verifiedCount: 3 }),
      audit({ seq: 1, event: 'goal_created' }),
      audit({ seq: 2, event: 'task_queued' })
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    const timeline = buildGoalEvidenceTimeline(input, [task()])
    expect(timeline.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(input).toEqual(snapshot)
  })

  it('deduplicates repeated audit rows by sequence, keeping the first occurrence', () => {
    const timeline = buildGoalEvidenceTimeline([
      audit({ seq: 1, event: 'goal_created' }),
      audit({ seq: 1, event: 'goal_stopped' }),
      audit({ seq: 2, event: 'task_queued' })
    ], [])
    expect(timeline).toHaveLength(2)
    expect(timeline[0]?.event).toBe('goal_created')
  })

  it('flags invalid timestamps without dropping the event', () => {
    const timeline = buildGoalEvidenceTimeline([
      audit({ seq: 1, event: 'goal_created', happenedAt: 'garbage' }),
      audit({ seq: 2, event: 'task_queued', happenedAt: '2026-10-25T01:00:00.000Z' })
    ], [])
    expect(timeline[0]?.happenedAtValid).toBe(false)
    expect(timeline[0]?.happenedAt).toBe('garbage')
    expect(timeline[1]?.happenedAtValid).toBe(true)
    // Rows are deduplicated by seq before ordering, so a duplicate sequence
    // number can never reintroduce a dropped event.
    const duplicated = buildGoalEvidenceTimeline([
      audit({ seq: 1, event: 'goal_created', happenedAt: 'garbage' }),
      audit({ seq: 1, event: 'goal_created', happenedAt: '2026-10-25T01:00:00.000Z' })
    ], [])
    expect(duplicated).toHaveLength(1)
    expect(duplicated[0]?.happenedAt).toBe('garbage')
  })

  it('joins the independently verified tool result exactly once per matched task', () => {
    const timeline = buildGoalEvidenceTimeline(
      [audit({ seq: 1, event: 'action_succeeded', taskId, actionId, resultCount: 3, verifiedCount: 3 })],
      [task()]
    )
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.verification).toEqual({
      taskId,
      toolId: 'memory.count_active',
      toolVersion: '1',
      resultCount: 3,
      verifiedCount: 3,
      verificationStatus: 'matched'
    })
  })

  it('leaves verification null when the task or action does not match, instead of inventing evidence', () => {
    const unrelated = task()
    const timeline = buildGoalEvidenceTimeline(
      [audit({ seq: 1, event: 'action_succeeded', taskId: '99999999-9999-4999-8999-999999999999', actionId, resultCount: 9 })],
      [unrelated]
    )
    expect(timeline[0]?.verification).toBeNull()
    expect(timeline[0]?.resultCount).toBe(9)
  })

  it('keeps pending and rejected approvals visible as non-facts with their real status', () => {
    const timeline = buildGoalEvidenceTimeline([
      audit({ seq: 1, event: 'approval_requested', status: 'awaiting_approval', reason: 'user_requested_approval' }),
      audit({ seq: 2, event: 'approval_rejected', status: 'cancelled', reason: 'user_rejected' })
    ], [])
    expect(timeline.map((entry) => entry.event)).toEqual(['approval_requested', 'approval_rejected'])
    expect(timeline.map((entry) => entry.status)).toEqual(['awaiting_approval', 'cancelled'])
    expect(timeline.every((entry) => entry.verification === null)).toBe(true)
  })

  it('handles an empty ledger and an empty task list without mutation', () => {
    expect(buildGoalEvidenceTimeline([], [])).toEqual([])
    const audits = [audit({ seq: 1, event: 'goal_created' })]
    buildGoalEvidenceTimeline(audits, [])
    expect(audits).toHaveLength(1)
  })
})

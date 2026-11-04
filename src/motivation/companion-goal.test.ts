import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { CompanionGoalService, describeGoals } from './companion-goal'

let directory = ''
let database: SqliteDatabase | undefined
afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function build(now = '2026-10-30T00:00:00.000Z') {
  directory = mkdtempSync(join(tmpdir(), 'morrow-goals-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return new CompanionGoalService(database, new EventLogService(database), () => now, () => randomUUID())
}

describe('companion goals', () => {
  it('defaults to a user goal with neutral priority', () => {
    const goals = build()
    const goal = goals.create({ title: '完成长期陪伴项目' })
    expect(goal.owner).toBe('user')
    expect(goal.priority).toBe(3)
    expect(goal.status).toBe('active')
  })

  it('rejects a goal without a title or with an out-of-range priority', () => {
    const goals = build()
    expect(() => goals.create({ title: '   ' })).toThrow()
    expect(() => goals.create({ title: '目标', priority: 9 })).toThrow()
    expect(() => goals.create({ title: '目标', priority: 2.5 })).toThrow()
  })

  it('orders the prompt candidates by priority', () => {
    const goals = build()
    goals.create({ title: '低优先', priority: 5 })
    const high = goals.create({ title: '高优先', priority: 1 })
    const context = goals.activeForContext(2)
    expect(context[0]!.id).toBe(high.id)
  })

  it('expires an overdue goal and stops offering it', () => {
    const goals = build()
    const overdue = goals.create({ title: '过期目标', dueAt: '2026-09-01T00:00:00.000Z' })
    expect(goals.activeForContext(3).some((goal) => goal.id === overdue.id)).toBe(false)
    expect(goals.get(overdue.id)!.status).toBe('expired')
  })

  it('keeps a due-today goal active until the deadline passes', () => {
    const goals = build()
    const goal = goals.create({ title: '今天到期', dueAt: '2026-12-01T00:00:00.000Z' })
    expect(goals.activeForContext(3).some((item) => item.id === goal.id)).toBe(true)
  })

  it('resumes an expired goal but never a cancelled one', () => {
    const goals = build()
    const expired = goals.create({ title: '过期', dueAt: '2026-01-01T00:00:00.000Z' })
    goals.activeForContext(3)
    expect(goals.get(expired.id)!.status).toBe('expired')
    expect(goals.resume(expired.id)!.status).toBe('active')

    const cancelled = goals.create({ title: '取消' })
    goals.cancel(cancelled.id)
    expect(() => goals.resume(cancelled.id)).toThrow()
  })

  it('drops a completed goal out of the context', () => {
    const goals = build()
    const goal = goals.create({ title: '要完成的' })
    expect(goals.activeForContext(3).some((item) => item.id === goal.id)).toBe(true)
    goals.complete(goal.id)
    expect(goals.activeForContext(3).some((item) => item.id === goal.id)).toBe(false)
  })

  it('keeps progress append-only and removes it with the goal', () => {
    const goals = build()
    const goal = goals.create({ title: '分步目标' })
    goals.recordProgress({ goalId: goal.id, kind: 'step', note: '完成第一步' })
    goals.recordProgress({ goalId: goal.id, kind: 'blocker', note: '缺少数据' })
    expect(goals.progress(goal.id)).toHaveLength(2)
    goals.delete(goal.id)
    expect(goals.progress(goal.id)).toHaveLength(0)
  })

  it('keeps the three ownership classes apart in the prompt line', () => {
    const line = describeGoals([
      { id: 'a', title: '用户的目标', owner: 'user', priority: 2, dueAt: null },
      { id: 'b', title: '共同计划', owner: 'shared', priority: 2, dueAt: null },
      { id: 'c', title: 'Morrow 的问题', owner: 'morrow', priority: 3, dueAt: null }
    ])
    expect(line).toContain('Goals the user stated')
    expect(line).toContain('Plans both sides agreed on')
    expect(line).toContain('Questions Morrow is pursuing')
    expect(line).not.toContain('Goals the user stated (their plan, not yours): 共同计划')
  })

  it('returns no line when there is nothing to say', () => {
    expect(describeGoals([])).toBe('')
  })
})

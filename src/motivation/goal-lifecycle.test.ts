/**
 * P1-6: long-term goal lifecycle.
 *
 * Three defects this pins down:
 *
 *   1. the horizon was detected and then thrown away — goals were created with
 *      `dueAt: null`, so the date the user said never reached the prompt;
 *   2. the title was a regex slice of the whole clause, so the deadline was
 *      pasted into the goal name;
 *   3. accepting a candidate was a read-then-write with no transaction and no
 *      idempotency key, so a retry or a concurrent accept could create two
 *      goals — and a deleted source message left an acceptable orphan.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { CompanionGoalService, readGoalUtterance } from './companion-goal'
import { resolveDueAt } from './goal-time'

let databases: SqliteDatabase[] = []
afterEach(() => {
  for (const database of databases) {
    try { database.close() } catch { /* already closed */ }
  }
  databases = []
})

const NOW = '2026-10-31T09:00:00.000Z'
const clock = (): string => NOW

function open(): SqliteDatabase {
  const database = SqliteDatabase.open(':memory:')
  databases.push(database)
  return database
}

function seedMessage(database: SqliteDatabase): { conversationId: string; messageId: string } {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'test', NOW, NOW)
  const sequence = Number((database.connection.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE conversation_id = ?'
  ).get(conversationId) as { next: number }).next)
  database.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(messageId, conversationId, 'user', '我打算在明年三月之前完成 Morrow 的第一阶段。', NOW, sequence, randomUUID())
  return { conversationId, messageId }
}

describe('goal time resolution', () => {
  it('resolves a year-month horizon to the end of that month in UTC+8', () => {
    const due = resolveDueAt('我打算在明年三月之前完成 Morrow 的第一阶段。', NOW)
    expect(due.unresolved).toBe(false)
    expect(due.dueAt).toBe('2027-03-31T15:59:59.000Z')
    expect(due.expression).toBe('明年三月')
  })

  it('resolves a relative day count', () => {
    expect(resolveDueAt('我打算3天后把草稿写完。', NOW).dueAt).toBe('2026-11-03T15:59:59.000Z')
  })

  it('resolves an explicit date', () => {
    expect(resolveDueAt('我计划在2027年1月15日之前交付。', NOW).dueAt).toBe('2027-01-15T15:59:59.000Z')
  })

  it('keeps an unresolvable horizon as a question instead of inventing a date', () => {
    const due = resolveDueAt('我打算以后多读点书。', NOW)
    expect(due.dueAt).toBeNull()
    expect(due.unresolved).toBe(true)
    expect(due.expression).toBe('以后')
  })
})

describe('goal candidate reading', () => {
  it('keeps the deadline out of the title', () => {
    const reading = readGoalUtterance({ text: '我打算在明年三月之前完成 Morrow 的第一阶段。', now: NOW })
    expect(reading.intent).toBe('commitment')
    expect(reading.content).toBe('完成 Morrow 的第一阶段')
    expect(reading.dueAt).toBe('2027-03-31T15:59:59.000Z')
    expect(reading.needsConfirmation).toBe(false)
    expect(reading.owner).toBe('user')
  })

  it('marks a joint plan as shared rather than the user\'s private goal', () => {
    const reading = readGoalUtterance({ text: '我们打算下个月之前一起把原型做出来。', now: NOW })
    expect(reading.owner).toBe('shared')
    expect(reading.dueAt).toBe('2026-11-30T15:59:59.000Z')
  })

  it('refuses a suggestion addressed to Morrow instead of reassigning it to her', () => {
    const reading = readGoalUtterance({ text: '你可以研究一下蛋白质折叠，说不定会有用。', now: NOW })
    expect(reading.intent).toBe('none')
    expect(reading.gate).toBe('delegated')
  })

  it('refuses questions, negations, quotes, hypotheticals and role-play', () => {
    const cases: Array<[string, string]> = [
      ['我打算明年三月之前完成这个吗？', 'question'],
      ['我不打算明年三月之前完成了。', 'negated'],
      ['他说「我打算明年三月之前完成」。', 'quoted'],
      ['如果我打算明年三月之前完成，你会怎么想？', 'hypothetical'],
      ['假设你是项目经理，我打算明年三月之前完成。', 'role_play']
    ]
    for (const [text, gate] of cases) {
      expect({ text, gate: readGoalUtterance({ text, now: NOW }).gate }).toEqual({ text, gate })
    }
  })

  it('creates a candidate with the raw horizon when the date cannot be resolved', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    const result = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算以后多读点书。' })
    expect(result.goalId).toBeNull()
    expect(result.candidateId).not.toBeNull()
    const candidate = goals.listCandidates().find((item) => item.id === result.candidateId)!
    expect(candidate.dueAt).toBeNull()
    expect(candidate.dueExpression).toBe('以后')
    expect(goals.list()).toHaveLength(0)
  })
})

describe('goal creation and lifecycle', () => {
  it('writes the resolved deadline onto the created goal', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    const result = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算在明年三月之前完成 Morrow 的第一阶段。' })
    expect(result.goalId).not.toBeNull()
    const goal = goals.get(result.goalId!)!
    expect(goal.dueAt).toBe('2027-03-31T15:59:59.000Z')
    expect(goal.title).toBe('完成 Morrow 的第一阶段')
    expect(goal.owner).toBe('user')
    expect(goal.sourceMessageId).toBe(messageId)
  })

  it('is idempotent on the source message: a replay creates one goal', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    const text = '我打算在明年三月之前完成 Morrow 的第一阶段。'
    const first = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text })
    const second = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text })
    expect(second.goalId).toBe(first.goalId)
    expect(goals.list()).toHaveLength(1)
  })

  it('accepts a candidate atomically and exposes it to the next prompt with its deadline', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算以后多读点书。' })
    const candidate = goals.listCandidates()[0]!

    const goal = goals.acceptCandidate(candidate.id)
    expect(goals.get(goal.id)?.status).toBe('active')
    expect(goals.listCandidates()).toHaveLength(0)
    const context = goals.activeForContext(5)
    expect(context.some((item) => item.id === goal.id)).toBe(true)
  })

  it('cancels the goal and expires the candidate when the source message is deleted', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    const created = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算在明年三月之前完成 Morrow 的第一阶段。' })
    goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算以后多读点书。' })

    database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)

    expect(goals.get(created.goalId!)?.status).toBe('cancelled')
    expect(goals.activeForContext(5)).toHaveLength(0)
    expect(goals.listCandidates()).toHaveLength(0)
  })

  it('drops a completed or expired goal from the next prompt', () => {
    const database = open()
    const goals = new CompanionGoalService(database, clock)
    const { conversationId, messageId } = seedMessage(database)
    const created = goals.detectFromTurn({ conversationId, sourceMessageId: messageId, text: '我打算在明年三月之前完成 Morrow 的第一阶段。' })
    expect(goals.activeForContext(5)).toHaveLength(1)

    goals.complete(created.goalId!)
    expect(goals.activeForContext(5)).toHaveLength(0)

    const second = goals.create({ title: '第二个目标', dueAt: '2026-10-01T00:00:00.000Z' })
    expect(goals.activeForContext(5).some((item) => item.id === second.id)).toBe(false)
    expect(goals.get(second.id)?.status).toBe('expired')
  })
})

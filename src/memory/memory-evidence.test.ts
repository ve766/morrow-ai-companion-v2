/**
 * P0-5: the repetition term must be fed by real user behaviour.
 *
 * The formula `R = 1 − e^(−n/3)` was always there; `n` was always zero in
 * production because nothing wrote `restatement` rows. The interesting half of
 * this file is therefore the refusals: a model repeating a fact, a question, a
 * negation, a quotation, a hypothetical and a role-play must all leave `n`
 * alone. A producer that counts everything is worse than no producer, because
 * it silently outranks facts the user actually cares about.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemoryService } from './memory-service'
import { MemoryImportanceService } from './memory-importance'
import { readMemoryUtterance, sameAssertion, normalizeAssertion } from './memory-evidence-policy'

let databases: SqliteDatabase[] = []
afterEach(() => {
  for (const database of databases) {
    try { database.close() } catch { /* already closed */ }
  }
  databases = []
})

function open(): SqliteDatabase {
  const database = SqliteDatabase.open(':memory:')
  databases.push(database)
  return database
}

function build(database: SqliteDatabase, clock: () => string = () => '2026-10-31T09:00:00.000Z') {
  const events = new EventLogService(database, clock)
  const importance = new MemoryImportanceService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clock, undefined, events, { importance })
  return { events, importance, memories }
}

function evidenceRows(database: SqliteDatabase, memoryId: string): Array<{ evidence_type: string; source_ref: string; independence_group: string }> {
  return database.connection.prepare(
    'SELECT evidence_type, source_ref, independence_group FROM memory_evidence WHERE memory_id = ? ORDER BY evidence_type, source_ref'
  ).all(memoryId) as Array<{ evidence_type: string; source_ref: string; independence_group: string }>
}

describe('memory evidence policy', () => {
  it('refuses every non-assertion before anything is written', () => {
    const cases: Array<[string, string]> = [
      ['我住在杭州吗？', 'question'],
      ['我不住在杭州了。', 'negated'],
      ['他说「我住在杭州」。', 'quoted'],
      ['如果住在杭州就好了。', 'hypothetical'],
      ['假设你是杭州人，你会怎么介绍？', 'role_play'],
      ['我觉得这个说法有问题。', 'discussion']
    ]
    for (const [text, reason] of cases) {
      const reading = readMemoryUtterance({ text })
      expect({ text, signal: reading.signal, reason: reading.reason }).toEqual({ text, signal: 'none', reason })
    }
  })

  it('treats Morrow repeating the fact as model text, never as a user restatement', () => {
    const reading = readMemoryUtterance({ text: '你住在杭州。', actor: 'morrow' })
    expect(reading.signal).toBe('none')
    expect(reading.reason).toBe('model_text')
  })

  it('matches only the same assertion, not a similar one', () => {
    expect(sameAssertion(normalizeAssertion('我住在杭州。'), normalizeAssertion('我住在杭州'))).toBe(true)
    expect(sameAssertion(normalizeAssertion('我住在杭州'), normalizeAssertion('我想去杭州'))).toBe(false)
  })
})

describe('memory evidence production', () => {
  it('records a restatement only when the user asserts the same fact again', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我住在杭州。', 'personal')
    const before = importance.get(memory.id)!.score

    const messageId = randomUUID()
    const recorded = memories.observeUtterance({
      text: '我住在杭州。',
      messageId,
      conversationId: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-10-31T09:00:00.000Z'
    })

    expect(recorded).toEqual([{ memoryId: memory.id, signal: 'restatement' }])
    const rows = evidenceRows(database, memory.id)
    expect(rows.filter((row) => row.evidence_type === 'restatement')).toHaveLength(1)
    const after = importance.get(memory.id)!
    expect(after.components.repetition).toBeGreaterThan(0)
    expect(after.score).toBeGreaterThan(before)
    // The formula's input is the number of independent groups, not of rows.
    expect(rows.find((row) => row.evidence_type === 'restatement')!.independence_group)
      .toBe('11111111-1111-4111-8111-111111111111')
  })

  it('counts a repeated turn once, however often it is projected', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我住在杭州。', 'personal')
    const messageId = randomUUID()
    for (let index = 0; index < 5; index += 1) {
      memories.observeUtterance({
        text: '我住在杭州。',
        messageId,
        conversationId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-10-31T09:00:00.000Z'
      })
    }
    expect(evidenceRows(database, memory.id).filter((row) => row.evidence_type === 'restatement')).toHaveLength(1)
    const rows = evidenceRows(database, memory.id).filter((row) => row.evidence_type === 'restatement')
    expect(rows[0]!.source_ref).toBe(messageId)
    expect(importance.get(memory.id)!.components.repetition).toBeCloseTo(1 - Math.exp(-1 / 3), 4)
  })

  it('counts three turns in one conversation as one independent group', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我住在杭州。', 'personal')
    for (let index = 0; index < 3; index += 1) {
      memories.observeUtterance({
        text: '我住在杭州。',
        messageId: randomUUID(),
        conversationId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-10-31T09:00:00.000Z'
      })
    }
    const rows = evidenceRows(database, memory.id).filter((row) => row.evidence_type === 'restatement')
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row) => row.independence_group)).size).toBe(1)
    expect(importance.get(memory.id)!.components.repetition).toBeCloseTo(1 - Math.exp(-1 / 3), 4)
  })

  it('records a confirmation for confirm() without treating it as a repetition', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我对花生过敏。', 'personal')
    const before = importance.get(memory.id)!
    memories.confirm(memory.id)
    const rows = evidenceRows(database, memory.id)
    expect(rows.filter((row) => row.evidence_type === 'confirmation')).toHaveLength(1)
    // A confirmation is not a repetition: the user agreed, they did not restate.
    expect(rows.filter((row) => row.evidence_type === 'restatement')).toHaveLength(0)
    expect(importance.get(memory.id)!.components.repetition).toBe(before.components.repetition)
  })

  it('suppresses the repetition contribution after a retraction', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我住在杭州。', 'personal')
    memories.observeUtterance({
      text: '我住在杭州。',
      messageId: randomUUID(),
      conversationId: '11111111-1111-4111-8111-111111111111',
      occurredAt: '2026-10-31T09:00:00.000Z'
    })
    expect(importance.get(memory.id)!.components.repetition).toBeGreaterThan(0)

    memories.retract(memory.id)
    expect(importance.get(memory.id)!.components.repetition).toBe(0)
    expect(evidenceRows(database, memory.id).some((row) => row.evidence_type === 'retraction')).toBe(true)
  })

  it('drops the evidence when the source message is deleted', () => {
    const database = open()
    const { importance, memories } = build(database)
    const memory = memories.create('我住在杭州。', 'personal')
    const conversationId = '11111111-1111-4111-8111-111111111111'
    const messageId = randomUUID()
    database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, 'test', '2026-10-31T09:00:00.000Z', '2026-10-31T09:00:00.000Z')
    database.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(messageId, conversationId, 'user', '我住在杭州。', '2026-10-31T09:00:00.000Z', 1, randomUUID())
    memories.observeUtterance({
      text: '我住在杭州。',
      messageId,
      conversationId,
      occurredAt: '2026-10-31T09:00:00.000Z'
    })
    expect(evidenceRows(database, memory.id).filter((row) => row.evidence_type === 'restatement')).toHaveLength(1)

    database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
    expect(evidenceRows(database, memory.id).filter((row) => row.evidence_type === 'restatement')).toHaveLength(0)
  })

  it('changes the retrieval ranking once the fact has been restated', () => {
    const database = open()
    const { memories } = build(database)
    const green = memories.create('我平时喝龙井茶。', 'personal')
    const white = memories.create('我平时喝白茶。', 'personal')
    // Give the white tea memory independent restatements in separate sessions.
    for (const conversationId of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4111-8111-222222222222',
      '33333333-3333-4111-8111-333333333333'
    ]) {
      memories.observeUtterance({
        text: '我平时喝白茶。',
        messageId: randomUUID(),
        conversationId,
        occurredAt: '2026-10-31T09:00:00.000Z'
      })
    }

    const assembled = memories.assembleContext('我平时喝什么茶？', 'personal')
    const order = assembled.selected.map((item) => item.id)
    expect(order).toContain(white.id)
    expect(order).toContain(green.id)
    // The restated fact ranks first although both match the query.
    expect(order.indexOf(white.id)).toBeLessThan(order.indexOf(green.id))
  })
})

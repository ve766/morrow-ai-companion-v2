import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryService, type MemoryEventSink } from './memory-service'
import type { MorrowEvent } from '../persistence/event-log'
import { isStaleMemory, normalizedMemoryKey } from './memory-domain'
import type { MorrowEvent as MorrowEventRecord } from '../persistence/event-log'
import { SqliteDatabase } from '../persistence/database'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'

let directory = ''
let database: SqliteDatabase | undefined

function openService(path: string, options: { clock?: () => string; events?: MemoryEventSink } = {}) {
  database = SqliteDatabase.open(path)
  return new MemoryService(new SqliteMemoryRepository(database), options.clock, () => randomUUID(), options.events)
}

afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

function recordingSink(events: MorrowEventRecord[]): MemoryEventSink {
  return {
    tryRecord(event) {
      events.push({ ...event, id: randomUUID(), schemaVersion: 1, occurredAt: new Date().toISOString() } as MorrowEventRecord)
      return null
    }
  }
}

describe('memory provenance, dedup and conflict extension', () => {
  it('merges re-entered duplicates into a confirmation instead of forking a record', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-dedup-'))
    const events: MorrowEventRecord[] = []
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const service = openService(join(directory, 'morrow.sqlite3'), { clock, events: recordingSink(events) })
    const first = service.create('用户喜欢茉莉花茶', 'personal')
    const merged = service.create('用户喜欢茉莉花茶', 'personal', { correlationId: randomUUID() })
    expect(merged.id).toBe(first.id)
    expect(merged.revision).toBe(2)
    expect(merged.confidence).toBe(90)
    expect(service.list()).toHaveLength(1)
    // cosmetic differences still merge
    const mergedAgain = service.create('  用户喜欢茉莉花茶 ', 'personal')
    expect(mergedAgain.id).toBe(first.id)
    expect(mergedAgain.confidence).toBe(95)
    expect(events.some((event) => event.eventType === 'memory.created')).toBe(true)
    expect(events.some((event) => event.eventType === 'memory.confirmed')).toBe(true)
  })

  it('distinguishes model-inferred confirmed memories from directly typed input', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-source-'))
    const service = openService(join(directory, 'morrow.sqlite3'))
    const typed = service.create('用户明确输入的偏好', 'personal')
    const inferred = service.create('模型推断且经用户确认的事实', 'personal', { sourceCategory: 'model_inferred_confirmed', confidence: 70 })
    expect(typed.sourceCategory).toBe('user_explicit_input')
    expect(typed.confidence).toBe(85)
    expect(inferred.sourceCategory).toBe('model_inferred_confirmed')
    expect(inferred.confidence).toBe(70)
    expect(() => service.create('x', 'personal', { sourceCategory: 'made_up_source' as never })).toThrow()
    expect(() => service.create('x', 'personal', { confidence: 0 })).toThrow()
    expect(() => service.create('x', 'personal', { confidence: 101 })).toThrow()
  })

  it('flags same-subject conflicts and records the advisory event without blocking', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-conflict-'))
    const events: MorrowEventRecord[] = []
    const service = openService(join(directory, 'morrow.sqlite3'), { events: recordingSink(events) })
    const first = service.create('用户住在上海，在浦东上班', 'personal')
    const second = service.create('用户住在上海，在浦西上学', 'personal')
    const unrelated = service.create('完全不相关的另一条记忆', 'normal')
    expect(service.detectConflicts(first.id).conflictsWith.map((item) => item.id)).toContain(second.id)
    expect(service.detectConflicts(unrelated.id).conflictsWith).toEqual([])
    expect(events.some((event) => event.eventType === 'memory.conflict_flagged')).toBe(true)
  })

  it('records a full audit trail with correlation ids and supports rollback-free confirm transitions', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-audit-'))
    const events: MorrowEventRecord[] = []
    const correlationId = randomUUID()
    let tick = 0
    const clock = () => new Date(Date.parse('2026-10-25T10:00:00.000Z') + (tick++) * 60_000).toISOString()
    const service = openService(join(directory, 'morrow.sqlite3'), { clock, events: recordingSink(events) })
    const record = service.create('需要纠正的记忆', 'personal')
    const corrected = service.correct(record.id, '用户纠正后的内容', correlationId)
    expect(corrected.revision).toBe(2)
    expect(corrected.lastConfirmedAt).toBe('2026-10-25T10:01:00.000Z')
    expect(corrected.lastConfirmedAt).toBe(corrected.updatedAt)
    const changeTypes = service.history(record.id).map((revision) => revision.changeType)
    expect(changeTypes).toEqual(['created', 'corrected'])
    const eventTypes = events.map((event) => event.eventType)
    expect(eventTypes).toEqual(['memory.created', 'memory.corrected'])
    expect(events[1]?.correlationId).toBe(correlationId)
    expect(events[1]?.actor).toBe('user')
    expect(events[1]?.subjectId).toBe(record.id)
  })

  it('persists memory events into the unified event journal and keeps them across reopen', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-journal-'))
    const path = join(directory, 'morrow.sqlite3')
    database = SqliteDatabase.open(path)
    const journal = new EventLogService(database)
    const service = new MemoryService(new SqliteMemoryRepository(database), undefined, () => randomUUID(), journal)
    const record = service.create('进入统一事件日志的记忆', 'normal')
    service.retract(record.id)

    const reopened = new EventLogService(database)
    const trail = reopened.list({ subjectType: 'memory', ascending: true })
    expect(trail.map((event) => event.eventType)).toEqual(['memory.created', 'memory.retracted'])
    expect(trail[0]?.sourceModule).toBe('memory')
    expect(trail[0]?.actor).toBe('user')
  })

  it('detects stale unconfirmed records and normalizes duplicate keys', () => {
    const record = {
      status: 'active' as const,
      lastConfirmedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(isStaleMemory(record, '2026-10-25T00:00:00.000Z')).toBe(true)
    expect(isStaleMemory({ ...record, lastConfirmedAt: '2026-09-01T00:00:00.000Z' }, '2026-10-25T00:00:00.000Z')).toBe(false)
    expect(isStaleMemory({ ...record, status: 'retracted' as const }, '2026-10-25T00:00:00.000Z')).toBe(false)
    expect(normalizedMemoryKey('  ＡＢＣ   def ')).toBe('abc def')
  })
})

import { describe, expect, it } from 'vitest'
import { applyMigrations } from './migrations'
import { EventLogService, EVENT_LOG_SCHEMA_VERSION, validateMorrowEvent } from './event-log'
import { SqliteDatabase } from './database'

function createDatabase(): SqliteDatabase {
  const database = SqliteDatabase.open(':memory:')
  applyMigrations(database.connection)
  return database
}

const baseEvent = {
  sourceModule: 'memory',
  eventType: 'memory.corrected',
  actor: 'user',
  subjectType: 'memory',
  subjectId: '0b6c1bd1-1111-4111-8111-111111111111',
  correlationId: '5a1b1bd1-2222-4222-8222-222222222222',
  payload: { revision: 2 }
} as const

describe('unified event log', () => {
  it('records and lists events with filtering by subject, type and correlation', () => {
    const database = createDatabase()
    let sequence = 0
    const events = new EventLogService(database, () => '2026-10-25T10:00:00.000Z', () => `0a0a0a0a-0000-4000-8000-${String(sequence++).padStart(12, '0')}`)

    const recorded = events.record(baseEvent)
    expect(recorded.schemaVersion).toBe(EVENT_LOG_SCHEMA_VERSION)
    expect(recorded.occurredAt).toBe('2026-10-25T10:00:00.000Z')
    events.record({ ...baseEvent, eventType: 'memory.created', subjectId: null, correlationId: '5a1b1bd1-3333-4333-8333-333333333333', payload: {} })

    expect(events.count()).toBe(2)
    expect(events.count('memory.corrected')).toBe(1)
    expect(events.list({ eventType: 'memory.corrected' })).toHaveLength(1)
    expect(events.list({ subjectType: 'memory', subjectId: null })).toHaveLength(1)
    expect(events.list({ correlationId: '5a1b1bd1-2222-4222-8222-222222222222' })).toHaveLength(1)
    expect(events.list({ ascending: true })[0]?.eventType).toBe('memory.corrected')
  })

  it('rejects invalid events instead of writing untraceable records', () => {
    const database = createDatabase()
    const events = new EventLogService(database)
    expect(() => events.record({ ...baseEvent, eventType: 'Bad Type!' })).toThrow(TypeError)
    expect(() => events.record({ ...baseEvent, sourceModule: 'not-a-module' as never })).toThrow(TypeError)
    expect(() => events.record({ ...baseEvent, payload: { text: 'x'.repeat(3000) } })).toThrow(TypeError)
    expect(events.count()).toBe(0)
    expect(validateMorrowEvent({ ...baseEvent, id: '0a0a0a0a-0000-4000-8000-000000000001', schemaVersion: 1, occurredAt: '2026-10-25T10:00:00.000Z' })).toBeUndefined()
  })

  it('tryRecord swallows failures so observability cannot break the loop', () => {
    const database = createDatabase()
    const events = new EventLogService(database)
    expect(events.tryRecord({ ...baseEvent, eventType: 'nope!' })).toBeNull()
    expect(events.tryRecord(baseEvent)?.eventType).toBe('memory.corrected')
  })

  it('persists across reopen so event history survives restarts', () => {
    const database = createDatabase()
    const events = new EventLogService(database, () => '2026-10-25T11:00:00.000Z')
    events.record(baseEvent)

    const reopened = new EventLogService(database)
    expect(reopened.count()).toBe(1)
    expect(reopened.list()[0]?.payload).toEqual({ revision: 2 })
  })
})

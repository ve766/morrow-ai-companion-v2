import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryService } from '../memory-service'
import { SqliteDatabase } from '../../persistence/database'
import { SqliteMemoryRepository } from '../../persistence/memory-repository'
import { EventLogService } from '../../persistence/event-log'
import { RETRIEVAL_ALGORITHM_V1, RETRIEVAL_ALGORITHM_V2 } from './retrieval-config'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const NOW = '2026-10-25T00:00:00.000Z'

function openDatabase(): { database: SqliteDatabase; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-retrieval-'))
  directories.push(directory)
  const path = join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(path)
  databases.push(database)
  return { database, path }
}

afterEach(() => {
  while (databases.length > 0) {
    try { databases.pop()?.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('retrieval decision trace through the memory service', () => {
  it('records a bounded, text-free decision in the unified event journal', () => {
    const { database } = openDatabase()
    const events = new EventLogService(database, () => NOW)
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID(), events)
    memories.create('I prefer concise answers.', 'personal')
    memories.create('The user lives in Suzhou.', 'personal')

    memories.assembleContext('concise answers', 'personal', { now: NOW })

    const [event] = events.list({ eventType: 'retrieval.decision' })
    expect(event).toBeDefined()
    expect(event?.sourceModule).toBe('memory')
    expect(event?.subjectType).toBe('memory_retrieval')
    expect(event?.payload).toMatchObject({ algorithm: RETRIEVAL_ALGORITHM_V1, considered: 2, selected: 1 })
    // The trace must not smuggle memory or query text into the journal.
    const serialized = JSON.stringify(event?.payload)
    expect(serialized).not.toContain('concise')
    expect(serialized).not.toContain('Suzhou')
  })

  it('leaves the memory lifecycle trail untouched by retrieval events', () => {
    const { database } = openDatabase()
    const events = new EventLogService(database, () => NOW)
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID(), events)
    const created = memories.create('I prefer concise answers.', 'personal')
    memories.correct(created.id, 'I prefer detailed answers.')
    memories.assembleContext('detailed answers', 'personal', { now: NOW })

    expect(events.list({ subjectType: 'memory', ascending: true }).map((event) => event.eventType))
      .toEqual(['memory.created', 'memory.corrected'])
  })
})

describe('cross-record correction chain with a real database', () => {
  it('stops the replaced statement from returning as a new memory', () => {
    const { database } = openDatabase()
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID())

    const original = memories.create('I like green tea.', 'personal')
    memories.correct(original.id, 'I prefer black tea now.')
    // The user (or an accepted suggestion) restates the replaced fact later.
    const restated = memories.create('I like green tea.', 'personal')
    expect(restated.id).not.toBe(original.id)

    const baseline = memories.retrieveWithDecision('green tea', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V1 }
    })
    expect(baseline.context.selected.map((item) => item.id)).toContain(restated.id)

    const upgraded = memories.retrieveWithDecision('green tea', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })
    expect(upgraded.context.selected.map((item) => item.id)).not.toContain(restated.id)
    expect(upgraded.decision.exclusionCounts.superseded_statement).toBe(1)
  })

  it('still retrieves the corrected memory itself', () => {
    const { database } = openDatabase()
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID())
    const original = memories.create('I like green tea.', 'personal')
    memories.correct(original.id, 'I prefer black tea now.')

    const result = memories.retrieveWithDecision('black tea', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })
    expect(result.context.selected.map((item) => item.id)).toEqual([original.id])
    expect(result.context.text).toContain('black tea')
    expect(result.context.text).not.toContain('green tea')
  })

  it('does not resurrect a statement whose correction was retracted', () => {
    const { database } = openDatabase()
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID())
    const original = memories.create('I like green tea.', 'personal')
    memories.correct(original.id, 'I prefer black tea now.')
    // Retracting the corrected record removes it from the active correction
    // chain, so the old statement is no longer "explicitly replaced".
    memories.retract(original.id)
    const restated = memories.create('I like green tea.', 'personal')

    const result = memories.retrieveWithDecision('green tea', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })
    expect(result.context.selected.map((item) => item.id)).toEqual([restated.id])
    expect(result.decision.exclusionCounts.superseded_statement).toBe(0)
  })

  it('never surfaces a deleted memory through the correction chain', () => {
    const { database } = openDatabase()
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID())
    const secret = memories.create('My passport number is synthetic.', 'personal')
    memories.correct(secret.id, 'I would rather not store that.')
    memories.delete(secret.id)

    const result = memories.retrieveWithDecision('passport number', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })
    expect(result.context.selected).toEqual([])
    expect(result.context.text).not.toContain('passport')
    expect(result.decision.exclusionCounts.superseded_statement).toBe(0)
  })
})

describe('determinism across a restart', () => {
  it('replays the same ranking after reopening the database', () => {
    const { database, path } = openDatabase()
    const memories = new MemoryService(new SqliteMemoryRepository(database), () => NOW, () => randomUUID())
    memories.create('I prefer concise answers.', 'personal')
    memories.create('I drink coffee every morning.', 'personal')
    memories.create('I prefer tea in the afternoon.', 'personal')

    const before = memories.retrieveWithDecision('prefer', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })
    database.close()
    databases.splice(databases.indexOf(database), 1)

    const reopened = SqliteDatabase.open(path)
    databases.push(reopened)
    const restored = new MemoryService(new SqliteMemoryRepository(reopened), () => NOW, () => randomUUID())
    const after = restored.retrieveWithDecision('prefer', 'personal', {
      now: NOW,
      config: { algorithm: RETRIEVAL_ALGORITHM_V2 }
    })

    expect(after.context.text).toBe(before.context.text)
    expect(after.decision.selectedIds).toEqual(before.decision.selectedIds)
  })
})

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from './database'
import { applyMigrations, CURRENT_SCHEMA_VERSION, type Migration } from './migrations'
import { SqliteMemoryRepository } from './memory-repository'

const timestamp = '2026-10-22T00:00:00.000Z'
const memoryId = '06d9f3b8-941d-49c6-8214-3b2324c40791'

let temporaryDirectory: string

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'morrow-memory-'))
})

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

function clockSequence(): () => string {
  let tick = 0
  return () => new Date(Date.parse(timestamp) + tick++ * 60_000).toISOString()
}

function count(database: SqliteDatabase, table: 'memories' | 'memory_revisions'): number {
  const row = database.connection.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

describe('SQLite schema and migrations', () => {
  it('initializes an empty profile, upgrades a legacy schema and retains records', () => {
    const databasePath = join(temporaryDirectory, 'morrow.sqlite3')
    const legacy = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true })
    expect(applyMigrations(legacy, 1)).toBe(1)
    legacy.prepare(`INSERT INTO memories(id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(memoryId, 'A legacy user-entered memory.', 'active', timestamp, timestamp)
    legacy.close()

    const upgraded = SqliteDatabase.open(databasePath)
    expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(upgraded.connection.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    expect(upgraded.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => ({ version: index + 1 })))
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goals'").get())
      .toEqual({ name: 'goals' })
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goal_audit'").get())
      .toEqual({ name: 'goal_audit' })
    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(upgraded.connection.prepare('SELECT sensitivity FROM memories WHERE id = ?').get(memoryId)).toEqual({ sensitivity: 'personal' })
    const service = new MemoryService(new SqliteMemoryRepository(upgraded), clockSequence(), () => memoryId)
    expect(service.list()).toEqual([expect.objectContaining({
      id: memoryId,
      originalText: 'A legacy user-entered memory.',
      currentText: 'A legacy user-entered memory.',
      sourceCategory: 'user_explicit_input',
      status: 'active',
      revision: 1
    })])
    expect(service.history(memoryId)).toEqual([expect.objectContaining({
      memoryId,
      revision: 1,
      content: 'A legacy user-entered memory.',
      changeType: 'created',
      previousRevision: null
    })])
    upgraded.close()

    const reopened = SqliteDatabase.open(databasePath)
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(new MemoryService(new SqliteMemoryRepository(reopened)).list()).toHaveLength(1)
    reopened.close()
  })

  it('rolls back all DDL and the migration version when an upgrade fails', () => {
    const database = new DatabaseSync(':memory:')
    const failingMigration: Migration = {
      version: 1,
      name: 'failing-upgrade',
      up(connection) {
        connection.exec('CREATE TABLE partial_upgrade(id TEXT PRIMARY KEY) STRICT;')
        throw new Error('private path and content must not escape')
      }
    }

    expect(() => applyMigrations(database, 1, [failingMigration])).toThrow('Database migration failed.')
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_upgrade'").all()).toEqual([])
    expect(database.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({ count: 0 })
    database.close()
  })

  it('refuses a newer schema without rewriting it', () => {
    const database = SqliteDatabase.open(':memory:')
    database.connection.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(CURRENT_SCHEMA_VERSION + 1, 'future', timestamp)
    expect(() => applyMigrations(database.connection)).toThrow('Unsupported database schema version.')
    expect(database.connection.prepare('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1').get())
      .toEqual({ version: CURRENT_SCHEMA_VERSION + 1, name: 'future' })
    database.close()
  })
})

describe('durable memory lifecycle', () => {
  it('stores only explicit user input and preserves the original plus every correction revision', () => {
    const databasePath = join(temporaryDirectory, 'profile', 'morrow.sqlite3')
    const database = SqliteDatabase.open(databasePath)
    const service = new MemoryService(new SqliteMemoryRepository(database), clockSequence(), () => memoryId)
    const originalText = 'I prefer paper books.'
    const initial = service.create(originalText)
    const corrected = service.correct(memoryId, 'I prefer printed books.')
    const correctedAgain = service.correct(memoryId, 'I prefer paper books for long reading.')

    expect(initial).toMatchObject({
      id: memoryId,
      originalText,
      currentText: originalText,
      sourceCategory: 'user_explicit_input',
      status: 'active',
      revision: 1
    })
    expect(correctedAgain).toMatchObject({
      originalText,
      currentText: 'I prefer paper books for long reading.',
      revision: 3
    })
    expect(service.history(memoryId).map((revision) => [revision.revision, revision.changeType, revision.previousRevision, revision.content]))
      .toEqual([
        [1, 'created', null, originalText],
        [2, 'corrected', 1, 'I prefer printed books.'],
        [3, 'corrected', 2, 'I prefer paper books for long reading.']
      ])
    expect(service.search('paper books')).toHaveLength(1)
    expect(service.search('printed books')).toEqual([])

    database.close()
    const reopened = SqliteDatabase.open(databasePath)
    const recovered = new MemoryService(new SqliteMemoryRepository(reopened))
    expect(recovered.list()[0]).toMatchObject({ currentText: 'I prefer paper books for long reading.', revision: 3 })
    expect(recovered.history(memoryId)).toHaveLength(3)
    reopened.close()
  })

  it('excludes retracted memories from search until the user explicitly restores them', () => {
    const database = SqliteDatabase.open(join(temporaryDirectory, 'morrow.sqlite3'))
    const service = new MemoryService(new SqliteMemoryRepository(database), clockSequence(), () => memoryId)
    service.create('The user explicitly saved a preference for tea.')
    service.retract(memoryId)

    expect(service.list()[0]?.status).toBe('retracted')
    expect(service.search('preference for tea')).toEqual([])
    expect(service.history(memoryId).at(-1)).toMatchObject({ status: 'retracted', changeType: 'retracted', previousRevision: 1 })

    service.restore(memoryId)
    expect(service.search('preference for tea')).toHaveLength(1)
    expect(service.history(memoryId).at(-1)).toMatchObject({ status: 'active', changeType: 'restored', previousRevision: 2 })
    database.close()
  })

  it('hard-deletes the memory and its revision lineage across database reopen', () => {
    const databasePath = join(temporaryDirectory, 'morrow.sqlite3')
    const database = SqliteDatabase.open(databasePath)
    const service = new MemoryService(new SqliteMemoryRepository(database), clockSequence(), () => memoryId)
    service.create('A private memory that the user chose to delete.')
    service.correct(memoryId, 'A corrected private memory that the user chose to delete.')
    service.delete(memoryId)

    expect(count(database, 'memories')).toBe(0)
    expect(count(database, 'memory_revisions')).toBe(0)
    expect(service.list()).toEqual([])
    expect(service.search('private memory')).toEqual([])
    expect(() => service.history(memoryId)).toThrow()
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()

    const reopened = SqliteDatabase.open(databasePath)
    const recovered = new MemoryService(new SqliteMemoryRepository(reopened))
    expect(recovered.list()).toEqual([])
    expect(recovered.search('private memory')).toEqual([])
    expect(count(reopened, 'memories')).toBe(0)
    expect(count(reopened, 'memory_revisions')).toBe(0)
    reopened.close()
  })

  it('rolls back a failed write instead of leaving a partial memory', () => {
    const database = SqliteDatabase.open(':memory:')
    database.connection.exec(`
      CREATE TRIGGER fail_memory_revision
      BEFORE INSERT ON memory_revisions
      BEGIN
        SELECT RAISE(ABORT, 'private input must not be logged');
      END;
    `)
    const service = new MemoryService(new SqliteMemoryRepository(database), clockSequence(), () => memoryId)

    expect(() => service.create('This content must never be half-saved.')).toThrow()
    expect(count(database, 'memories')).toBe(0)
    expect(count(database, 'memory_revisions')).toBe(0)
    database.close()
  })
})

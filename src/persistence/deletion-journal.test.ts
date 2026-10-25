import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from './migrations'
import { SqliteDatabase } from './database'
import { SqliteConversationRepository } from './conversation-repository'
import { SqliteMemoryRepository } from './memory-repository'
import { readLatestDeletionStates, recordDeletionState } from './deletion-journal'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function createProfile(): { database: SqliteDatabase; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-deletion-journal-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return { database, cleanup: () => database.close() }
}

describe('deletion boundary journal', () => {
  it('is created by migration v11 and remains present in the current schema', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11)
    const { database, cleanup } = createProfile()
    const table = database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deletion_journal'").get()
    expect(table).toBeTruthy()
    cleanup()
  })

  it('records hard-deleted memories as deleted and keeps the state after restart', () => {
    const { database, cleanup } = createProfile()
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const created = memories.create('备份前删除的记忆', 'personal')
    expect(memories.delete(created.id)).toBeUndefined()
    const states = readLatestDeletionStates(database)
    expect(states.get(`memory:${created.id}`)).toEqual({ state: 'deleted', entityId: created.id })
    cleanup()

    const reopened = SqliteDatabase.open(database.path)
    expect(readLatestDeletionStates(reopened).get(`memory:${created.id}`)?.state).toBe('deleted')
    reopened.close()
  })

  it('records retraction and un-retraction so a later backup restore cannot resurrect the wrong state', () => {
    const { database, cleanup } = createProfile()
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const created = memories.create('撤销边界检查', 'personal')
    memories.retract(created.id)
    expect(readLatestDeletionStates(database).get(`memory:${created.id}`)?.state).toBe('retracted')
    memories.restore(created.id)
    expect(readLatestDeletionStates(database).get(`memory:${created.id}`)?.state).toBe('unretracted')
    cleanup()
  })

  it('does not journal corrections or creations', () => {
    const { database, cleanup } = createProfile()
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const created = memories.create('更正边界检查', 'personal')
    memories.correct(created.id, '更正后的内容')
    expect(readLatestDeletionStates(database).size).toBe(0)
    cleanup()
  })

  it('records hard-deleted conversations so restores cannot resurrect them', () => {
    const { database, cleanup } = createProfile()
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const created = conversations.create('将被删除的对话')
    conversations.delete(created.id)
    const states = readLatestDeletionStates(database)
    expect(states.get(`conversation:${created.id}`)?.state).toBe('deleted')
    cleanup()
  })

  it('keeps journal entries inside the same transaction as the deletion', () => {
    const { database, cleanup } = createProfile()
    const memories = new MemoryService(new SqliteMemoryRepository(database))
    const created = memories.create('事务边界', 'personal')
    // recordDeletionState participates in the caller's transaction exactly like
    // the repositories use it: rolling back the surrounding transaction must
    // undo both the deletion and the journal entry together.
    database.connection.exec('BEGIN IMMEDIATE')
    database.connection.prepare('DELETE FROM memories WHERE id = ?').run(created.id)
    recordDeletionState(database, 'memory', created.id, 'deleted', '2026-10-25T00:00:00.000Z')
    database.connection.exec('ROLLBACK')
    expect(memories.list()).toHaveLength(1)
    expect(readLatestDeletionStates(database).size).toBe(0)
    cleanup()
  })

  it('ignores malformed journal rows and unknown identifiers when reading', () => {
    const { database, cleanup } = createProfile()
    const id = randomUUID()
    database.connection.prepare("INSERT INTO deletion_journal(entity, entity_id, state, recorded_at) VALUES ('memory', ?, 'deleted', ?)").run(id, '2026-10-25T00:00:00.000Z')
    expect(readLatestDeletionStates(database).get(`memory:${id}`)?.state).toBe('deleted')
    expect(readLatestDeletionStates(database).size).toBe(1)
    cleanup()
  })
})

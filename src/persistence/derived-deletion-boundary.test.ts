/**
 * A2 — deletion and recovery boundaries for derived cognition.
 *
 * These tests open a real database at an older schema, upgrade it, and then
 * delete rows the way a product path would. They assert on stored rows, not on
 * helper return values, because the guarantee lives in the schema.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from '../persistence/migrations'

const timestamp = '2026-10-29T00:00:00.000Z'
let directory = ''

afterEach(() => {
  // A failing assertion can leave the connection open; cleanup must not mask
  // the real failure with an EBUSY error.
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

interface BoundaryIds {
  conversationId: string
  turnId: string
  userMessageId: string
  assistantMessageId: string
}

function openAt(version: number): { connection: DatabaseSync; ids: BoundaryIds } {
  directory = mkdtempSync(join(tmpdir(), 'morrow-delete-boundary-'))
  const connection = new DatabaseSync(join(directory, 'morrow.sqlite3'))
  expect(applyMigrations(connection, version)).toBe(version)

  const ids: BoundaryIds = {
    conversationId: randomUUID(),
    turnId: randomUUID(),
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID()
  }
  connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(ids.conversationId, 'boundary', timestamp, timestamp)
  const insertMessage = connection.prepare(
    'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  insertMessage.run(ids.userMessageId, ids.conversationId, 'user', '我住在杭州。', timestamp, 1, ids.turnId)
  insertMessage.run(ids.assistantMessageId, ids.conversationId, 'assistant', '好的。', timestamp, 2, ids.turnId)
  connection.prepare(
    `INSERT INTO cognitive_turn_finalizations(turn_id, conversation_id, user_message_id, assistant_message_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, '{}', ?)`
  ).run(ids.turnId, ids.conversationId, ids.userMessageId, ids.assistantMessageId, timestamp)
  connection.exec('PRAGMA foreign_keys = ON;')
  return { connection, ids }
}

describe('A2 derived cognition follows its source data', { timeout: 20_000 }, () => {
  // Each case applies the full migration set; migration 25 (three triggers on
  // `memories`) pushed the slowest ones past the 5s default, so the suite gets
  // an explicit budget instead of a timeout that depends on machine speed.
  it('keeps every existing row when upgrading v18 to the current schema', () => {
    const { connection, ids } = openAt(18)
    const before = connection.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }
    expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)
    const after = connection.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }
    expect(after.count).toBe(before.count)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_finalizations WHERE turn_id = ?').get(ids.turnId))
      .toEqual({ count: 1 })
    connection.close()
  })

  it('treats a second migration run as a no-op', () => {
    const { connection } = openAt(18)
    expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)
    expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)
    const applied = connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    expect(applied.count).toBe(CURRENT_SCHEMA_VERSION)
    connection.close()
  })

  it('removes derived cognition when its source message is deleted', () => {
    const { connection, ids } = openAt(18)
    applyMigrations(connection)
    connection.prepare(
      `INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
       VALUES (?, 'fact', '居住地：杭州', 'active', 55, ?, ?, NULL, ?, ?)`
    ).run(randomUUID(), ids.userMessageId, ids.conversationId, timestamp, timestamp)

    connection.prepare('DELETE FROM messages WHERE id = ?').run(ids.userMessageId)

    expect(connection.prepare('SELECT COUNT(*) AS count FROM self_model_entries WHERE source_message_id = ?').get(ids.userMessageId))
      .toEqual({ count: 0 })
    // The turn finalization names that message, so it must not outlive it.
    expect(connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_finalizations WHERE user_message_id = ?').get(ids.userMessageId))
      .toEqual({ count: 0 })
    connection.close()
  })

  it('removes conversation-scoped cognition when the conversation is deleted', () => {
    const { connection, ids } = openAt(18)
    applyMigrations(connection)
    connection.prepare('DELETE FROM conversations WHERE id = ?').run(ids.conversationId)

    expect(connection.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(ids.conversationId))
      .toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_finalizations WHERE conversation_id = ?').get(ids.conversationId))
      .toEqual({ count: 0 })
    connection.close()
  })
})

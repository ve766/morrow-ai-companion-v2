import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations } from '../persistence/migrations'
import { deriveSelfFactStatement } from './self-fact-statement'

const timestamp = '2026-10-29T00:00:00.000Z'
let directory = ''

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('self-model statements are derived, never copied', () => {
  it('reduces an affirmative self fact to a bounded predicate and value', () => {
    expect(deriveSelfFactStatement('我住在杭州。')).toBe('居住地：杭州')
  })

  it('refuses questions, negations and prose instead of storing the sentence', () => {
    expect(deriveSelfFactStatement('我住在哪里？')).toBeNull()
    // A long personal story has no single slot: the turn is skipped rather than
    // copied, because a placeholder fact would only become prompt noise.
    expect(deriveSelfFactStatement('我今天下午在公司和同事聊了很久，后来去买了菜，然后回家做饭，顺便看了会儿书。')).toBeNull()
    expect(deriveSelfFactStatement('')).toBeNull()
    expect(deriveSelfFactStatement('   ')).toBeNull()
  })

  it('never returns the original message as the statement', () => {
    const message = '我住在杭州。'
    const statement = deriveSelfFactStatement(message)
    expect(statement).not.toBe(message)
    expect(statement).not.toContain('我住在')
  })
})

describe('migration 20 stops historical copies', () => {
  it('retracts rows that were a literal copy of their source message and leaves other rows alone', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-self-model-copy-'))
    const path = join(directory, 'morrow.sqlite3')
    const connection = new DatabaseSync(path)
    expect(applyMigrations(connection, 19)).toBe(19)

    const conversationId = randomUUID()
    const copiedMessageId = randomUUID()
    const ordinaryMessageId = randomUUID()
    const rawText = '我住在杭州，家里还有一只叫咪咪的猫。'
    connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, 'copy test', timestamp, timestamp)
    const insertMessage = connection.prepare(
      'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    insertMessage.run(copiedMessageId, conversationId, 'user', rawText, timestamp, 1, randomUUID())
    insertMessage.run(ordinaryMessageId, conversationId, 'user', '我今天有点累。', timestamp, 2, randomUUID())

    const insertEntry = connection.prepare(
      `INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
       VALUES (?, 'fact', ?, 'active', 55, ?, ?, NULL, ?, ?)`
    )
    const copiedId = randomUUID()
    const derivedId = randomUUID()
    insertEntry.run(copiedId, rawText, copiedMessageId, conversationId, timestamp, timestamp)
    // A statement that is not a copy must survive untouched.
    insertEntry.run(derivedId, '居住地：杭州', ordinaryMessageId, conversationId, timestamp, timestamp)

    expect(applyMigrations(connection, 20)).toBe(20)

    const copied = connection.prepare('SELECT statement, status, source_message_id FROM self_model_entries WHERE id = ?')
      .get(copiedId) as { statement: string; status: string; source_message_id: string }
    expect(copied.status).toBe('retracted')
    expect(copied.statement).not.toContain('咪咪')
    expect(copied.statement).not.toContain('杭州')
    // The evidence reference survives, so the fact is still recoverable from the
    // message that is its source of truth.
    expect(copied.source_message_id).toBe(copiedMessageId)

    const derived = connection.prepare('SELECT statement, status FROM self_model_entries WHERE id = ?')
      .get(derivedId) as { statement: string; status: string }
    expect(derived.status).toBe('active')
    expect(derived.statement).toBe('居住地：杭州')

    const message = connection.prepare('SELECT body FROM messages WHERE id = ?').get(copiedMessageId) as { body: string }
    expect(message.body).toBe(rawText)

    connection.close()
  })
})

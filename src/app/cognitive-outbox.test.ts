import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { CognitionOutbox, OUTBOX_MAX_ATTEMPTS, type CognitiveProjector } from './cognitive-outbox'

let directory = ''
let database: SqliteDatabase | undefined

afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function open(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-outbox-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return database
}

/** A turn needs a real conversation and message for the FK-free refs to resolve. */
function seedTurn(db: SqliteDatabase, turnId: string): { conversationId: string; messageId: string } {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  const at = '2026-10-31T00:00:00.000Z'
  db.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'test', at, at)
  db.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(messageId, conversationId, 'user', '我最近在读神经科学。', at, 1, turnId)
  return { conversationId, messageId }
}

function projector(module: CognitiveProjector['module'], run: () => void, version = 1): CognitiveProjector {
  return { module, version, project: run }
}

describe('CognitionOutbox', () => {
  it('writes one pending row per module and nothing more on a replay', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)

    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })

    expect(outbox.pending().length).toBe(6)
    expect(outbox.stats()).toEqual({ pending: 6, failed: 0, cancelled: 0 })
  })

  it('isolates a failing module so the others still run', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })

    const ran: string[] = []
    const projectors = [
      projector('interest', () => { ran.push('interest') }),
      projector('preference', () => { throw new Error('boom') }),
      projector('growth', () => { ran.push('growth') })
    ]
    const result = outbox.drain(projectors)

    // Modules are consumed in a stable order (by module name), so a replay is
    // reproducible rather than dependent on insertion order.
    expect(ran.sort()).toEqual(['growth', 'interest'])
    expect(result.done).toBe(2)
    expect(result.failed).toBe(1)
    // The failed row stays pending for the next attempt; the two modules with no
    // projector in this drain are skipped, not silently marked done.
    expect(outbox.stats()).toEqual({ pending: 4, failed: 0, cancelled: 0 })
  })

  it('is idempotent: draining ten times applies each module once', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })

    let calls = 0
    const projectors = [projector('interest', () => { calls += 1 })]
    for (let index = 0; index < 10; index += 1) outbox.drain(projectors)

    expect(calls).toBe(1)
    expect(outbox.stats()).toEqual({ pending: 5, failed: 0, cancelled: 0 })
  })

  it('parks a permanently failing row instead of retrying forever', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null, modules: ['interest'] })

    const projectors = [projector('interest', () => { throw new Error('always') })]
    for (let index = 0; index < OUTBOX_MAX_ATTEMPTS; index += 1) outbox.drain(projectors)

    expect(outbox.pending()).toHaveLength(0)
    expect(outbox.stats()).toEqual({ pending: 0, failed: 1, cancelled: 0 })
  })

  it('replays what a crash left behind, reading the source text at projection time', () => {
    const db = open()
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    new CognitionOutbox(db).enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null, modules: ['interest'] })

    // A new process, same database: only the pending row survives, and the
    // projector still gets the user's words — from `messages`, not from a copy.
    const restarted = new CognitionOutbox(db)
    let read = ''
    restarted.drain([{ module: 'interest', version: 1, project: (input) => { read = input.readUserMessage() } }])

    expect(read).toBe('我最近在读神经科学。')
    expect(restarted.stats().pending).toBe(0)
  })

  it('cancels pending cognition when the turn is deleted', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })

    db.connection.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)

    expect(outbox.pending()).toHaveLength(0)
    expect(outbox.stats()).toEqual({ pending: 0, failed: 0, cancelled: 6 })
  })

  it('never stores the user text, only references', () => {
    const db = open()
    const outbox = new CognitionOutbox(db)
    const turnId = randomUUID()
    const { conversationId, messageId } = seedTurn(db, turnId)
    outbox.enqueue({ turnId, conversationId, userMessageId: messageId, occurredAt: '2026-10-31T00:00:00.000Z', analysis: null })

    const dump = JSON.stringify(db.connection.prepare('SELECT * FROM cognitive_outbox').all())
    expect(dump).not.toContain('神经科学')
    // The reference is there, so the projector can read the source at run time.
    expect(dump).toContain(messageId)
  })
})

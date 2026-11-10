/**
 * Stage 5 final closeout (Issue #29): F1 deletion privacy, F2 user-message
 * obligation timing and replay races, both on the production assembly.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStack, systemText, type Stack } from '../../evals/stage-3/runner/harness'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from '../persistence/migrations'

let stacks: Stack[] = []
afterEach(() => {
  for (const stack of stacks) {
    try {
      stack.close()
    } catch {
      // already closed
    }
  }
  stacks = []
})

function open(databasePath?: string): Stack {
  const stack = buildStack({
    growth: true,
    exploration: true,
    reflection: true,
    ...(databasePath ? { databasePath, keepDatabase: true } : {})
  })
  stacks.push(stack)
  return stack
}

async function send(stack: Stack, conversationId: string, content: string, requestId = randomUUID()) {
  return stack.companion.sendChat({ conversationId, requestId, content, includeSensitive: false }, () => undefined)
}

interface ThreadRow {
  id: string
  kind: string
  value: string
  status: string
  source_message_id: string | null
  conversation_id: string | null
  tombstoned_at: string | null
}

const threads = (stack: Stack): ThreadRow[] =>
  stack.database.connection.prepare(
    'SELECT id, kind, value, status, source_message_id, conversation_id, tombstoned_at FROM relationship_threads ORDER BY kind'
  ).all() as unknown as ThreadRow[]

const evidenceCount = (stack: Stack): number =>
  (stack.database.connection.prepare('SELECT COUNT(*) AS n FROM relationship_thread_evidence').get() as { n: number }).n

function userMessage(stack: Stack, turnId: string): { id: string; created_at: string } {
  return stack.database.connection.prepare(
    "SELECT id, created_at FROM messages WHERE turn_id = ? AND role = 'user'"
  ).get(turnId) as { id: string; created_at: string }
}

describe('F1 — deletion erases relationship content', () => {
  it('deleting the source message tombstones the thread and no value survives', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    await send(stack, a.id, '以后叫我小林。', turn)
    expect(threads(stack)[0]).toMatchObject({ value: '小林', status: 'active' })
    stack.database.connection.prepare('DELETE FROM messages WHERE turn_id = ?').run(turn)
    const thread = threads(stack)[0]!
    expect(thread).toMatchObject({
      value: '',
      status: 'retracted',
      source_message_id: null,
      conversation_id: null
    })
    expect(thread.tombstoned_at).not.toBeNull()
    expect(evidenceCount(stack)).toBe(0)
    // Nothing personal may survive in the relationship tables.
    const personal = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM relationship_threads WHERE value LIKE '%小林%'"
    ).get() as { n: number }
    expect(personal.n).toBe(0)
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    expect(systemText(stack.provider.lastPayload)).not.toContain('"小林"')
  })

  it('deleting the conversation tombstones every thread it owned', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    expect(threads(stack).some((thread) => thread.status === 'active')).toBe(true)
    stack.companion.deleteConversation({ conversationId: a.id })
    expect(evidenceCount(stack)).toBe(0)
    for (const thread of threads(stack)) {
      expect(thread.status).toBe('retracted')
      expect(thread.value).toBe('')
      expect(thread.source_message_id).toBeNull()
      expect(thread.conversation_id).toBeNull()
    }
  })

  it('reconcile erases a thread whose evidence is an orphan and is idempotent', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    await send(stack, a.id, '以后叫我小林。', turn)
    const message = userMessage(stack, turn)
    stack.database.connection.prepare('DELETE FROM messages WHERE id = ?').run(message.id)
    stack.database.connection.prepare(
      "INSERT INTO relationship_thread_evidence(thread_id, source_message_id, conversation_id, polarity, weight, created_at) SELECT id, ?, ?, 'support', 1.0, ? FROM relationship_threads LIMIT 1"
    ).run(message.id, a.id, new Date().toISOString())
    const removed = stack.relationships.reconcile()
    expect(removed).toBe(1)
    expect(stack.relationships.reconcile()).toBe(0)
    const thread = threads(stack)[0]!
    expect(thread.value).toBe('')
    expect(thread.tombstoned_at).not.toBeNull()
  })

  it('the v46 migration backfills historical orphan evidence and erases content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-closeout-migration-'))
    const path = join(dir, 'morrow.sqlite3')
    const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true })
    try {
      applyMigrations(connection, 43)
      const conversationId = randomUUID()
      const messageId = randomUUID()
      const threadId = randomUUID()
      const at = '2026-10-01T08:00:00.000Z'
      connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'old', at, at)
      connection.prepare(
        "INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', ?, ?, 1, ?)"
      ).run(messageId, conversationId, '以后叫我小林。', at, randomUUID())
      connection.prepare(
        "INSERT INTO relationship_threads(id, kind, value, status, strength, confidence, source_message_id, conversation_id, supersedes_thread_id, first_seen_at, last_seen_at, expires_at, created_at, updated_at) VALUES (?, 'address_preference', '小林', 'active', 1, 80, ?, ?, NULL, ?, ?, NULL, ?, ?)"
      ).run(threadId, messageId, conversationId, at, at, at, at)
      connection.prepare(
        "INSERT INTO relationship_thread_evidence(thread_id, source_message_id, conversation_id, polarity, weight, created_at) VALUES (?, ?, ?, 'support', 1, ?)"
      ).run(threadId, messageId, conversationId, at)
      // The message is removed before v44's trigger existed: the classic
      // historical orphan the migration must clean.
      connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
      applyMigrations(connection, CURRENT_SCHEMA_VERSION)
      const thread = connection.prepare(
        'SELECT value, status, source_message_id, conversation_id, tombstoned_at FROM relationship_threads WHERE id = ?'
      ).get(threadId) as { value: string; status: string; source_message_id: string | null; conversation_id: string | null; tombstoned_at: string | null }
      expect(thread.value).toBe('')
      expect(thread.status).toBe('retracted')
      expect(thread.source_message_id).toBeNull()
      expect(thread.conversation_id).toBeNull()
      expect(thread.tombstoned_at).not.toBeNull()
      const evidence = connection.prepare('SELECT COUNT(*) AS n FROM relationship_thread_evidence').get() as { n: number }
      expect(evidence.n).toBe(0)
    } finally {
      try {
        connection.close()
      } catch {
        // already closed
      }
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file briefly.
      }
    }
  })
  it('an obligation with no source message is refused, not projected from cached text', () => {
    const stack = open()
    const turn = randomUUID()
    const messageId = randomUUID()
    const conversationId = randomUUID()
    stack.database.connection.prepare(
      "INSERT INTO cognitive_outbox(turn_id, module, handler_version, conversation_id, user_message_id, occurred_at, analysis_json, status, attempts, created_at, updated_at) VALUES (?, 'relationship', 1, ?, ?, ?, NULL, 'pending', 0, ?, ?)"
    ).run(turn, conversationId, messageId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
    const drained = stack.companion.drainCognition()
    expect(drained.skipped).toBeGreaterThanOrEqual(1)
    expect(threads(stack)).toHaveLength(0)
    expect(evidenceCount(stack)).toBe(0)
    const row = stack.database.connection.prepare(
      "SELECT status FROM cognitive_outbox WHERE module = 'relationship' AND turn_id = ?"
    ).get(turn) as { status: string }
    expect(row.status).toBe('cancelled')
  })

  it('a stale obligation whose message was deleted cannot revive it', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    await send(stack, a.id, '以后叫我小林。', turn)
    const message = userMessage(stack, turn)
    stack.database.connection.prepare('DELETE FROM messages WHERE id = ?').run(message.id)
    // A different holder may still have the obligation; re-create the pending
    // row after the delete to model exactly that stale copy.
    const staleTurn = randomUUID()
    stack.database.connection.prepare(
      "INSERT INTO cognitive_outbox(turn_id, module, handler_version, conversation_id, user_message_id, occurred_at, analysis_json, status, attempts, created_at, updated_at) VALUES (?, 'relationship', 1, ?, ?, ?, NULL, 'pending', 0, ?, ?)"
    ).run(staleTurn, a.id, message.id, message.created_at, new Date().toISOString(), new Date().toISOString())
    stack.companion.drainCognition()
    expect(threads(stack).every((thread) => thread.status === 'retracted' && thread.value === '')).toBe(true)
    expect(evidenceCount(stack)).toBe(0)
  })

  it('a database error while reading the source fails closed and writes nothing', () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const messageId = randomUUID()
    stack.database.connection.prepare(
      "INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', ?, ?, 1, ?)"
    ).run(messageId, a.id, '以后叫我小林。', new Date().toISOString(), randomUUID())
    const connection = stack.database.connection as unknown as { prepare: (sql: string) => unknown }
    const original = connection.prepare.bind(stack.database.connection)
    connection.prepare = ((sql: string) => {
      if (sql.includes('FROM messages WHERE id')) throw new Error('SQLITE_BUSY')
      return original(sql)
    }) as typeof connection.prepare
    try {
      expect(() => stack.relationships.observe({
        messageId,
        conversationId: a.id,
        at: new Date().toISOString()
      })).toThrow(/RELATIONSHIP_SOURCE_UNVERIFIABLE|RelationshipSourceError/)
    } finally {
      connection.prepare = original as typeof connection.prepare
    }
    expect(threads(stack)).toHaveLength(0)
    expect(evidenceCount(stack)).toBe(0)
  })

  it('a source from another conversation is refused', () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const b = stack.companion.createConversation()
    const messageId = randomUUID()
    stack.database.connection.prepare(
      "INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', ?, ?, 1, ?)"
    ).run(messageId, a.id, '以后叫我小林。', new Date().toISOString(), randomUUID())
    const result = stack.relationships.observe({
      messageId,
      conversationId: b.id,
      at: new Date().toISOString()
    })
    expect(result.skipped).toBe('source_conversation_mismatch')
    expect(threads(stack)).toHaveLength(0)
  })
})

describe('F2 — the obligation is committed with the user message', () => {
  it('a provider failure keeps the relationship obligation pending and it applies once later', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    stack.provider.failure = 'upstream timeout'
    await expect(send(stack, a.id, '以后叫我小林。', turn)).rejects.toThrow()
    stack.provider.failure = null
    // The user message is durable, the assistant message is not, and the
    // obligation is durable too.
    expect(userMessage(stack, turn).id).toBeTruthy()
    expect(stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE turn_id = ? AND role = 'assistant'"
    ).get(turn)).toMatchObject({ n: 0 })
    const queued = stack.database.connection.prepare(
      "SELECT status, user_message_id FROM cognitive_outbox WHERE module = 'relationship' AND turn_id = ?"
    ).get(turn) as { status: string; user_message_id: string } | undefined
    expect(queued).toMatchObject({ status: 'pending' })
    expect(queued?.user_message_id).toBe(userMessage(stack, turn).id)
    expect(threads(stack)).toHaveLength(0)
    const drained = stack.companion.drainCognition()
    expect(drained.done).toBeGreaterThanOrEqual(1)
    expect(threads(stack)[0]).toMatchObject({ value: '小林', status: 'active' })
    stack.companion.drainCognition()
    expect(evidenceCount(stack)).toBe(1)
  })

  it('a restart projects the pending obligation exactly once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morrow-closeout-restart-'))
    const path = join(dir, 'morrow.sqlite3')
    try {
      const first = open(path)
      const a = first.companion.createConversation()
      first.provider.failure = 'upstream timeout'
      await expect(send(first, a.id, '以后叫我小林。')).rejects.toThrow()
      first.provider.failure = null
      first.close()

      const second = open(path)
      expect(threads(second)).toHaveLength(0)
      const drained = second.companion.drainCognition()
      expect(drained.done).toBeGreaterThanOrEqual(1)
      expect(threads(second)[0]).toMatchObject({ value: '小林', status: 'active' })
      second.companion.drainCognition()
      expect(evidenceCount(second)).toBe(1)
      second.close()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // Windows can hold the file briefly.
      }
    }
  })

  it('deleting the conversation while the obligation is pending cancels it and projects nothing', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    stack.provider.failure = 'upstream timeout'
    await expect(send(stack, a.id, '以后叫我小林。', turn)).rejects.toThrow()
    stack.provider.failure = null
    stack.companion.deleteConversation({ conversationId: a.id })
    const row = stack.database.connection.prepare(
      "SELECT status FROM cognitive_outbox WHERE module = 'relationship' AND turn_id = ?"
    ).get(turn) as { status: string } | undefined
    expect(row?.status).toBe('cancelled')
    stack.companion.drainCognition()
    expect(threads(stack)).toHaveLength(0)
    expect(evidenceCount(stack)).toBe(0)
  })

  it('replaying the same turn adds one obligation and one evidence row', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const turn = randomUUID()
    for (let index = 0; index < 5; index += 1) await send(stack, a.id, '以后叫我小林。', turn)
    const queued = stack.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM cognitive_outbox WHERE module = 'relationship' AND turn_id = ?"
    ).get(turn) as { n: number }
    expect(queued.n).toBe(1)
    expect(evidenceCount(stack)).toBe(1)
  })

  it('a delayed older observation cannot compete with a newer address decision', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    const firstTurn = randomUUID()
    const secondTurn = randomUUID()
    await send(stack, a.id, '以后叫我阿林。', firstTurn)
    await send(stack, a.id, '以后叫我阿乐。', secondTurn)
    const first = userMessage(stack, firstTurn)
    // Replay the first message's observation after the newer decision landed.
    stack.relationships.observe({
      messageId: first.id,
      conversationId: a.id,
      at: first.created_at
    })
    const addresses = threads(stack).filter((thread) => thread.kind === 'address_preference')
    const active = addresses.filter((thread) => thread.status === 'active')
    expect(active.map((thread) => thread.value)).toEqual(['阿乐'])
    expect(addresses.find((thread) => thread.value === '阿林')?.status).toBe('superseded')
  })
})

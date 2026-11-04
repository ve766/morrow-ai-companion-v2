/**
 * AUD45-P1-01 outbox contract: when the reflection run is rate-limited and the
 * recovery sweep itself fails, the projection must NOT be marked done. The row
 * stays retryable and a later sweep that succeeds completes it.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { CognitionOutbox } from './cognitive-outbox'
import { buildCognitiveProjectors, type SelfModelLoopServices } from './companion-service'
import { PendingSchemaUnavailableError } from '../cognition/pending-items'

let directory = ''
afterEach(() => {
  if (directory) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows can hold the file briefly.
    }
    directory = ''
  }
})

function world(): { database: SqliteDatabase; events: EventLogService; conversationId: string; messageId: string } {
  directory = mkdtempSync(join(tmpdir(), 'morrow-outbox-reflection-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const events = new EventLogService(database)
  const conversationId = randomUUID()
  const messageId = randomUUID()
  const at = new Date().toISOString()
  database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'outbox', at, at)
  database.connection.prepare("INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', 'hello', ?, 1, ?)")
    .run(messageId, conversationId, at, randomUUID())
  return { database, events, conversationId, messageId }
}

function reflectionProjector(
  events: EventLogService,
  recover: () => { repaired: number; failed: number }
): ReturnType<typeof buildCognitiveProjectors>[number] {
  const services = {
    events,
    interests: {} as never,
    selfModel: {} as never,
    reflection: {
      run: () => ({ skipped: 'rate_limited' as const }),
      findings: () => []
    },
    findingRouter: {
      recoverUnrouted: recover,
      ingestRun: () => undefined
    }
  } as unknown as SelfModelLoopServices
  const projector = buildCognitiveProjectors(services).find((item) => item.module === 'reflection')
  if (!projector) throw new Error('reflection projector missing')
  return projector
}

describe('reflection outbox under a rate-limited run', () => {
  it('does not mark the row done while recovery still has failed findings', () => {
    const { database, events, conversationId, messageId } = world()
    try {
      const outbox = new CognitionOutbox(database)
      outbox.enqueue({
        turnId: randomUUID(),
        conversationId,
        userMessageId: messageId,
        occurredAt: new Date().toISOString(),
        analysis: null,
        modules: ['reflection']
      })
      let recovery = { repaired: 0, failed: 1 }
      const projector = reflectionProjector(events, () => recovery)

      const first = outbox.drain([projector])
      expect(first.failed).toBe(1)
      expect(first.done).toBe(0)
      const pending = database.connection.prepare("SELECT status, attempts FROM cognitive_outbox WHERE module = 'reflection'").get() as { status: string; attempts: number }
      expect(pending).toEqual({ status: 'pending', attempts: 1 })

      recovery = { repaired: 1, failed: 0 }
      expect(outbox.drain([projector]).done).toBe(1)
      expect(database.connection.prepare("SELECT status FROM cognitive_outbox WHERE module = 'reflection'").get()).toEqual({ status: 'done' })
    } finally {
      database.close()
    }
  })

  it('does not mark the row done when the schema cannot route findings', () => {
    const { database, events, conversationId, messageId } = world()
    try {
      const outbox = new CognitionOutbox(database)
      outbox.enqueue({
        turnId: randomUUID(),
        conversationId,
        userMessageId: messageId,
        occurredAt: new Date().toISOString(),
        analysis: null,
        modules: ['reflection']
      })
      const projector = reflectionProjector(events, () => { throw new PendingSchemaUnavailableError() })
      expect(outbox.drain([projector]).failed).toBe(1)
      expect(database.connection.prepare("SELECT status FROM cognitive_outbox WHERE module = 'reflection'").get()).toEqual({ status: 'pending' })
      const audit = database.connection.prepare(
        "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'cognition.pending_schema_unavailable'"
      ).get() as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      database.close()
    }
  })
})

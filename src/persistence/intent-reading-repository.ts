/**
 * Persistence for C1 intent readings.
 *
 * Three behaviours, and each of them is a requirement rather than a convenience:
 *
 *   1. **One reading per message.** A turn has one analysis; a second row would
 *      let two readers disagree about what the reply was built from.
 *   2. **Supersede, do not edit.** A correction or a change of mind retracts the
 *      earlier reading and points forward to the new one. The earlier row stays
 *      as history and stops being applied.
 *   3. **Deletion propagates.** The foreign key to `messages` removes the reading
 *      with the message, so a deleted turn cannot keep influencing the next one.
 *
 * The stored payload never contains the user's text: it holds labels, rule codes
 * and message ids only.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from './database'
import { isIntentReading, type IntentReading } from '../cognition/intent-reading'
import { ApplicationError } from '../shared/errors'

export interface IntentReadingRecord {
  readingId: string
  conversationId: string
  messageId: string
  turnId: string | null
  createdAt: string
  reading: IntentReading
  supersededByMessageId: string | null
  retractedAt: string | null
}

interface Row {
  reading_id: string
  conversation_id: string
  message_id: string
  turn_id: string | null
  created_at: string
  payload_json: string
  superseded_by_message_id: string | null
  retracted_at: string | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class IntentReadingRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  /**
   * Stores the reading for one user message.
   *
   * Idempotent on `message_id`: re-running the same turn (a duplicate request)
   * returns the existing row instead of inserting a second one. A *different*
   * reading for the same message is a conflict, because that means the analyzer
   * changed under a message that is already answered.
   */
  save(input: { conversationId: string; messageId: string; turnId?: string | null; reading: IntentReading }): IntentReadingRecord {
    if (!uuidPattern.test(input.conversationId) || !uuidPattern.test(input.messageId)) {
      throw new ApplicationError('INVALID_INPUT')
    }
    if (!isIntentReading(input.reading)) throw new ApplicationError('INVALID_INPUT')
    if (input.reading.messageId !== input.messageId) throw new ApplicationError('INVALID_INPUT')

    return this.database.transaction(() => {
      const existing = this.row(input.messageId)
      if (existing) {
        const stored = JSON.parse(existing.payload_json) as IntentReading
        if (stored.version !== input.reading.version ||
          stored.primaryIntent !== input.reading.primaryIntent ||
          stored.speechAct.act !== input.reading.speechAct.act) {
          throw new ApplicationError('CONFLICT')
        }
        return this.toRecord(existing)
      }
      const source = this.database.connection
        .prepare('SELECT role FROM messages WHERE id = ? AND conversation_id = ?')
        .get(input.messageId, input.conversationId) as unknown as { role: string } | undefined
      if (source?.role !== 'user') throw new ApplicationError('INVALID_INPUT')

      const createdAt = this.clock()
      const readingId = this.makeId().toLowerCase()
      this.database.connection.prepare(`
        INSERT INTO intent_readings(
          reading_id, conversation_id, message_id, turn_id, schema_version, algorithm_version, parameter_version,
          primary_intent, intent_status, speech_act, response_mode, score_kind, confidence, may_execute,
          clarification_required, supersedes_message_id, superseded_by_message_id, retracted_at, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(
        readingId,
        input.conversationId,
        input.messageId,
        input.turnId ?? null,
        input.reading.version,
        input.reading.algorithmVersion,
        input.reading.parameterVersion,
        input.reading.primaryIntent,
        input.reading.intentStatus,
        input.reading.speechAct.act,
        input.reading.responseMode,
        input.reading.scoreKind,
        input.reading.confidence,
        input.reading.mayExecute ? 1 : 0,
        input.reading.clarificationRequired ? 1 : 0,
        input.reading.supersedesMessageId,
        JSON.stringify(input.reading),
        createdAt
      )

      // The revision chain: everything this turn replaces stops being applied.
      if (input.reading.supersedesMessageId) {
        this.retractBefore(input.conversationId, input.messageId, createdAt)
      }
      // A retraction or refusal closes the old work as well as the old reading.
      // Leaving an open question behind is exactly the "old to-do still in the
      // next payload" failure.
      if (input.reading.responseMode === 'stop_previous') {
        this.closeOpenItems(input.conversationId, createdAt)
      }

      const stored = this.row(input.messageId)
      if (!stored) throw new ApplicationError('STORAGE_ERROR')
      return this.toRecord(stored)
    })
  }

  /** The newest reading in a conversation, retracted or not. */
  latest(conversationId: string): IntentReadingRecord | null {
    const row = this.database.connection.prepare(
      'SELECT * FROM intent_readings WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    ).get(conversationId) as unknown as Row | undefined
    return row ? this.toRecord(row) : null
  }

  /** Readings that still apply, newest first. */
  active(conversationId: string, limit = 10): IntentReadingRecord[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM intent_readings WHERE conversation_id = ? AND retracted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?'
    ).all(conversationId, limit) as unknown as Row[]
    return rows.map((row) => this.toRecord(row))
  }

  forMessage(messageId: string): IntentReadingRecord | null {
    const row = this.row(messageId)
    return row ? this.toRecord(row) : null
  }

  /** Retracts every active reading in a conversation. Returns the count. */
  retractConversation(conversationId: string, reason: string): number {
    const at = this.clock()
    const result = this.database.connection.prepare(
      'UPDATE intent_readings SET retracted_at = ? WHERE conversation_id = ? AND retracted_at IS NULL'
    ).run(at, conversationId)
    void reason
    this.closeOpenItems(conversationId, at)
    return Number(result.changes)
  }

  private row(messageId: string): Row | undefined {
    return this.database.connection.prepare('SELECT * FROM intent_readings WHERE message_id = ?')
      .get(messageId) as unknown as Row | undefined
  }

  /**
   * Retracts the readings this message revises.
   *
   * Scoped to the same conversation and to rows older than the new message, so a
   * late-arriving duplicate cannot retract the reading that replaced it.
   */
  private retractBefore(conversationId: string, messageId: string, at: string): void {
    this.database.connection.prepare(`
      UPDATE intent_readings
      SET retracted_at = ?, superseded_by_message_id = ?
      WHERE conversation_id = ? AND message_id <> ? AND retracted_at IS NULL
    `).run(at, messageId, conversationId, messageId)
  }

  private closeOpenItems(conversationId: string, at: string): void {
    this.database.connection.prepare(`
      UPDATE cognitive_pending_items
      SET status = 'done', completed_at = ?, updated_at = ?
      WHERE conversation_id = ? AND status = 'open' AND source = 'open_question'
    `).run(at, at, conversationId)
  }

  private toRecord(row: Row): IntentReadingRecord {
    return {
      readingId: row.reading_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      turnId: row.turn_id,
      createdAt: row.created_at,
      reading: JSON.parse(row.payload_json) as IntentReading,
      supersededByMessageId: row.superseded_by_message_id,
      retractedAt: row.retracted_at
    }
  }
}

import type { ConversationMessage, ConversationRecord, ConversationWithMessages } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { SqliteDatabase } from './database'
import { recordDeletionState } from './deletion-journal'
import { isCognitiveTurnRecord, type CognitiveTurnRecord } from '../cognition/cognition'

interface ConversationRow {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  body: string
  created_at: string
  sequence: number
  turn_id: string
  attempt: number | null
  analyzed_at: string | null
  schema_version: number | null
  analyzer_version: string | null
  analysis_json: string | null
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapMessages(rows: MessageRow[]): ConversationMessage[] {
  const messages = new Map<string, ConversationMessage>()
  for (const row of rows) {
    let message = messages.get(row.id)
    if (!message) {
      message = {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        body: row.body,
        createdAt: row.created_at,
        sequence: row.sequence,
        turnId: row.turn_id
      }
      messages.set(row.id, message)
    }
    if (row.attempt === null || row.analyzed_at === null || row.schema_version !== 1 || row.analyzer_version === null || row.analysis_json === null) continue
    try {
      const record: unknown = { attempt: row.attempt, analyzedAt: row.analyzed_at, analysis: JSON.parse(row.analysis_json) }
      if (!isCognitiveTurnRecord(record) || record.analysis.evidence.recordId !== row.id || record.analysis.analyzerVersion !== row.analyzer_version) continue
      message.cognitiveObservations ??= []
      message.cognitiveObservations.push(record)
    } catch {
      continue
    }
  }
  return [...messages.values()]
}

export class SqliteConversationRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(record: ConversationRecord): ConversationRecord {
    this.database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(record.id, record.title, record.createdAt, record.updatedAt)
    return record
  }

  list(limit: number): ConversationRecord[] {
    const rows = this.database.connection.prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC, id DESC LIMIT ?')
      .all(limit) as unknown as ConversationRow[]
    return rows.map(mapConversation)
  }

  read(id: string): ConversationWithMessages | null {
    const row = this.database.connection.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?')
      .get(id) as unknown as ConversationRow | undefined
    if (!row) return null
    const messages = (this.database.cognitivePersistenceAvailable
      ? this.database.connection.prepare(`
        SELECT m.id, m.conversation_id, m.role, m.body, m.created_at, m.sequence, m.turn_id,
          o.attempt, o.analyzed_at, o.schema_version, o.analyzer_version, o.analysis_json
        FROM messages m
        LEFT JOIN cognitive_turn_observations o ON o.source_message_id = m.id AND o.conversation_id = m.conversation_id
        WHERE m.conversation_id = ?
        ORDER BY m.sequence ASC, o.attempt ASC
      `)
      : this.database.connection.prepare(`
        SELECT id, conversation_id, role, body, created_at, sequence, turn_id,
          NULL AS attempt, NULL AS analyzed_at, NULL AS schema_version, NULL AS analyzer_version, NULL AS analysis_json
        FROM messages WHERE conversation_id = ? ORDER BY sequence ASC
      `)).all(id) as unknown as MessageRow[]
    return { conversation: mapConversation(row), messages: mapMessages(messages) }
  }

  append(
    message: Omit<ConversationMessage, 'sequence' | 'cognitiveObservations'>,
    updatedAt: string,
    title?: string,
    cognitiveObservation?: CognitiveTurnRecord,
    afterPersist?: (saved: ConversationWithMessages) => void
  ): ConversationWithMessages {
    return this.database.transaction(() => {
      const conversation = this.database.connection.prepare('SELECT id FROM conversations WHERE id = ?').get(message.conversationId)
      if (!conversation) throw new ApplicationError('NOT_FOUND')
      const existing = this.database.connection.prepare('SELECT id, conversation_id, role, body, created_at, sequence, turn_id FROM messages WHERE conversation_id = ? AND turn_id = ? AND role = ?')
        .get(message.conversationId, message.turnId, message.role) as unknown as MessageRow | undefined
      if (existing) {
        if (existing.body !== message.body || existing.id !== message.id) throw new ApplicationError('CONFLICT')
        if (cognitiveObservation) this.appendCognitiveObservation(message.id, message.conversationId, cognitiveObservation)
        const current = this.read(message.conversationId)
        if (!current) throw new ApplicationError('NOT_FOUND')
        afterPersist?.(current)
        return current
      }
      const sequence = Number(this.database.connection.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM messages WHERE conversation_id = ?')
        .get(message.conversationId)?.sequence ?? 1)
      this.database.connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.conversationId, message.role, message.body, message.createdAt, sequence, message.turnId)
      if (cognitiveObservation) this.appendCognitiveObservation(message.id, message.conversationId, cognitiveObservation)
      if (title !== undefined) {
        this.database.connection.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
          .run(title, updatedAt, message.conversationId)
      } else {
        this.database.connection.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
          .run(updatedAt, message.conversationId)
      }
      const result = this.read(message.conversationId)
      if (!result) throw new ApplicationError('NOT_FOUND')
      afterPersist?.(result)
      return result
    })
  }

  private appendCognitiveObservation(messageId: string, conversationId: string, record: CognitiveTurnRecord): void {
    if (!this.database.cognitivePersistenceAvailable || !isCognitiveTurnRecord(record) ||
      record.analysis.evidence.recordId !== messageId || record.analysis.evidence.evidenceRefs[0]?.id !== messageId) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const source = this.database.connection.prepare('SELECT role FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, conversationId) as unknown as { role: string } | undefined
    if (source?.role !== 'user') throw new ApplicationError('INVALID_INPUT')
    const latest = Number(this.database.connection.prepare('SELECT COALESCE(MAX(attempt), 0) AS attempt FROM cognitive_turn_observations WHERE source_message_id = ?')
      .get(messageId)?.attempt ?? 0)
    if (record.attempt !== latest + 1) throw new ApplicationError('CONFLICT')
    this.database.connection.prepare(`
      INSERT INTO cognitive_turn_observations(
        conversation_id, source_message_id, attempt, analyzed_at, schema_version, analyzer_version, analysis_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      messageId,
      record.attempt,
      record.analyzedAt,
      record.analysis.schemaVersion,
      record.analysis.analyzerVersion,
      JSON.stringify(record.analysis)
    )
  }

  delete(id: string): boolean {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      if (result.changes === 1) recordDeletionState(this.database, 'conversation', id, 'deleted', new Date().toISOString())
      return result.changes === 1
    })
  }
}

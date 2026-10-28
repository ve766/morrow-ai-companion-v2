import { ApplicationError } from '../shared/errors'
import { SqliteDatabase } from './database'
import { recordDeletionState } from './deletion-journal'
import type { MemoryChangeType, MemoryRecord, MemoryRevisionRecord, MemorySourceCategory, MemoryStatus } from '../memory/memory-domain'

interface MemoryRow {
  id: string
  original_text: string
  current_text: string
  source_category: string
  status: string
  created_at: string
  sensitivity: string
  updated_at: string
  revision: number
  confidence: number
  last_confirmed_at: string | null
}

interface RevisionRow {
  memory_id: string
  revision: number
  content: string
  source_category: string
  status: string
  change_type: string
  created_at: string
  previous_revision: number | null
  confidence: number
  sensitivity: string
  sensitivity_source: string
}

export interface MemoryRepository {
  create(record: MemoryRecord, revision: MemoryRevisionRecord): void
  get(id: string): MemoryRecord | null
  list(): MemoryRecord[]
  listActiveForContext(limit: number): MemoryRecord[]
  listSupersededTexts(): Array<{ memoryId: string; content: string; supersededAt: string }>
  countActive(): number
  countActiveForVerification(): number
  search(query: string): MemoryRecord[]
  history(id: string): MemoryRevisionRecord[] | null
  transition(previousRevision: number, record: MemoryRecord, revision: MemoryRevisionRecord): void
  delete(id: string): boolean
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    originalText: row.original_text,
    currentText: row.current_text,
    sourceCategory: row.source_category as MemorySourceCategory,
    status: row.status as MemoryStatus,
    sensitivity: row.sensitivity as MemoryRecord['sensitivity'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    confidence: row.confidence,
    lastConfirmedAt: row.last_confirmed_at
  }
}

function mapRevision(row: RevisionRow): MemoryRevisionRecord {
  return {
    memoryId: row.memory_id,
    revision: row.revision,
    content: row.content,
    sourceCategory: row.source_category as MemorySourceCategory,
    status: row.status as MemoryStatus,
    changeType: row.change_type as MemoryChangeType,
    createdAt: row.created_at,
    previousRevision: row.previous_revision,
    confidence: row.confidence,
    sensitivity: row.sensitivity as MemoryRevisionRecord['sensitivity'],
    sensitivitySource: row.sensitivity_source as MemoryRevisionRecord['sensitivitySource']
  }
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(record: MemoryRecord, revision: MemoryRevisionRecord): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, sensitivity, updated_at, revision, confidence, last_confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.originalText, record.currentText, record.sourceCategory, record.status, record.createdAt, record.sensitivity, record.updatedAt, record.revision, record.confidence, record.lastConfirmedAt)
      this.insertRevision(revision)
    })
  }

  get(id: string): MemoryRecord | null {
    const row = this.database.connection.prepare('SELECT * FROM memories WHERE id = ?').get(id) as unknown as MemoryRow | undefined
    return row ? mapMemory(row) : null
  }

  list(): MemoryRecord[] {
    const rows = this.database.connection.prepare('SELECT * FROM memories ORDER BY created_at DESC, id').all() as unknown as MemoryRow[]
    return rows.map(mapMemory)
  }

  /**
   * For every active record that was corrected, the text the correction
   * replaced. One query, no N+1: the context block needs it to mark a value as
   * history instead of letting the model treat it as current.
   */
  listSupersededTexts(): Array<{ memoryId: string; content: string; supersededAt: string }> {
    const rows = this.database.connection.prepare(`
      SELECT m.id AS memory_id, r.content AS content, r.created_at AS created_at
      FROM memories m
      JOIN memory_revisions r ON r.memory_id = m.id AND r.revision = m.revision - 1
      WHERE m.status = 'active' AND m.revision > 1
      ORDER BY m.updated_at DESC
    `).all() as unknown as Array<{ memory_id: string; content: string; created_at: string }>
    return rows.map((row) => ({ memoryId: row.memory_id, content: row.content, supersededAt: row.created_at }))
  }

  listActiveForContext(limit: number): MemoryRecord[] {
    const rows = this.database.connection.prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY updated_at DESC, id LIMIT ?")
      .all(limit) as unknown as MemoryRow[]
    return rows.map(mapMemory)
  }

  countActive(): number {
    const row = this.database.connection.prepare("SELECT count(*) AS count FROM memories WHERE status = 'active'").get() as unknown as { count: number }
    return row.count
  }

  countActiveForVerification(): number {
    const row = this.database.connection.prepare("SELECT count(id) AS count FROM memories WHERE status = 'active'").get() as unknown as { count: number }
    return row.count
  }

  search(query: string): MemoryRecord[] {
    const rows = this.database.connection.prepare(`
      SELECT * FROM memories
      WHERE status = 'active' AND instr(lower(current_text), lower(?)) > 0
      ORDER BY updated_at DESC, id
      LIMIT 200
    `).all(query) as unknown as MemoryRow[]
    return rows.map(mapMemory)
  }

  history(id: string): MemoryRevisionRecord[] | null {
    if (!this.get(id)) return null
    const rows = this.database.connection.prepare(`
      SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision
    `).all(id) as unknown as RevisionRow[]
    return rows.map(mapRevision)
  }

  transition(previousRevision: number, record: MemoryRecord, revision: MemoryRevisionRecord): void {
    this.database.transaction(() => {
      const previous = this.database.connection.prepare('SELECT status FROM memories WHERE id = ? AND revision = ?').get(record.id, previousRevision) as unknown as { status: string } | undefined
      if (!previous) throw new ApplicationError('CONFLICT')
      const result = this.database.connection.prepare(`
        UPDATE memories
        SET current_text = ?, status = ?, updated_at = ?, revision = ?, confidence = ?, last_confirmed_at = ?, sensitivity = ?
        WHERE id = ? AND revision = ?
      `).run(record.currentText, record.status, record.updatedAt, record.revision, record.confidence, record.lastConfirmedAt, record.sensitivity, record.id, previousRevision)
      if (result.changes !== 1) throw new ApplicationError('CONFLICT')
      this.insertRevision(revision)
      if (record.status === 'retracted') recordDeletionState(this.database, 'memory', record.id, 'retracted', record.updatedAt)
      else if (previous.status === 'retracted' && record.status === 'active') recordDeletionState(this.database, 'memory', record.id, 'unretracted', record.updatedAt)
    })
  }

  delete(id: string): boolean {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare('DELETE FROM memories WHERE id = ?').run(id)
      if (result.changes === 1) recordDeletionState(this.database, 'memory', id, 'deleted', new Date().toISOString())
      return result.changes === 1
    })
  }

  private insertRevision(revision: MemoryRevisionRecord): void {
    this.database.connection.prepare(`
      INSERT INTO memory_revisions(memory_id, revision, content, source_category, status, change_type, created_at, previous_revision, confidence, sensitivity, sensitivity_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.memoryId,
      revision.revision,
      revision.content,
      revision.sourceCategory,
      revision.status,
      revision.changeType,
      revision.createdAt,
      revision.previousRevision,
      revision.confidence,
      revision.sensitivity,
      revision.sensitivitySource
    )
  }
}

/**
 * Addressable fact layer over the existing memories (final closure, P0-A).
 *
 * The memories table stays the single source of truth for text, revisions and
 * lifecycle; this index makes individual facts *addressable by attribute*
 * (subject/predicate/value) so a personal-fact question does not depend on
 * word overlap with the sentence that recorded it. One row per
 * (source memory, predicate, value), extracted by the same `readFactSlot`
 * rules the retriever uses — the index can never disagree with the text.
 *
 * Lifecycle is mirrored, not invented:
 *   - memory retracted        → its facts become `retracted`;
 *   - memory corrected        → the previous value becomes `superseded`
 *                               (with the supersedes chain) and the current
 *                               value is `active`;
 *   - memory deleted          → rows disappear (FK CASCADE);
 *   - memory reinstated       → retraction is lifted on the next reindex.
 *
 * `reindexMemory` is idempotent (UNIQUE(source_memory_id, predicate, value)),
 * so calling it after every write and once at startup converges.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import { readFactSlot } from './fact-slot'

export const FACT_EXTRACTION_VERSION = 'fact-index-v1'

export interface FactRecord {
  id: string
  subject: 'user'
  predicate: string
  value: string
  factStatus: 'active' | 'superseded' | 'retracted' | 'uncertain'
  sourceMemoryId: string
  sourceMessageId: string | null
  validFrom: string
  validTo: string | null
  confidence: number
  supersedesFactId: string | null
  sensitivity: 'normal' | 'personal' | 'sensitive'
}

interface MemoryRow {
  id: string
  current_text: string
  status: string
  sensitivity: string
  confidence: number
  created_at: string
  updated_at: string
}

export class FactMemoryService {
  constructor(private readonly options: {
    database: SqliteDatabase
    clock?: (() => string) | undefined
    makeId?: (() => string) | undefined
  }) {}

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  /**
   * Re-derives the fact rows for one memory from its current text. Safe to
   * call any number of times; each (predicate, value) pair is stored once.
   */
  reindexMemory(memoryId: string): void {
    const memory = this.options.database.connection.prepare(
      'SELECT id, current_text, status, sensitivity, confidence, created_at, updated_at FROM memories WHERE id = ?'
    ).get(memoryId) as MemoryRow | undefined
    if (!memory) return
    const now = this.clock()
    const slot = readFactSlot(memory.current_text)
    const activePredicate = slot && slot.kind === 'assertion' && slot.value.length > 0 ? slot.predicate : null
    const timeState = slot?.time ?? 'unspecified'

    // The facts this memory used to carry: any stored row whose value is no
    // longer the current text's value is superseded (the memory was corrected)
    // or retracted (the memory itself was).
    const existing = this.options.database.connection.prepare(
      'SELECT id, predicate, value, fact_status FROM fact_records WHERE source_memory_id = ?'
    ).all(memoryId) as Array<{ id: string; predicate: string; value: string; fact_status: string }>
    for (const row of existing) {
      const stillCurrent = activePredicate !== null && row.predicate === activePredicate && row.value === slot!.value
      const targetStatus = memory.status !== 'active' ? 'retracted' : stillCurrent ? 'active' : 'superseded'
      if (row.fact_status !== targetStatus) {
        this.options.database.connection.prepare(
          'UPDATE fact_records SET fact_status = ?, valid_to = ?, updated_at = ? WHERE id = ?'
        ).run(targetStatus, targetStatus === 'active' ? null : now, now, row.id)
      }
    }

    if (activePredicate === null) return
    const existingActive = existing.find((row) => row.predicate === activePredicate && row.value === slot!.value)
    if (existingActive) return
    // A new value for a predicate this memory already asserted supersedes the
    // old row; a first assertion has no predecessor.
    const predecessor = this.options.database.connection.prepare(
      "SELECT id FROM fact_records WHERE source_memory_id = ? AND predicate = ? AND fact_status = 'superseded' ORDER BY updated_at DESC LIMIT 1"
    ).get(memoryId, activePredicate) as { id: string } | undefined
    this.options.database.connection.prepare(`
      INSERT INTO fact_records(id, subject, predicate, value, fact_status, source_memory_id, source_message_id, valid_from, valid_to, confidence, supersedes_fact_id, sensitivity, time_state, extraction_version, created_at, updated_at)
      VALUES (?, 'user', ?, ?, 'active', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_memory_id, predicate, value) DO NOTHING
    `).run(
      this.options.makeId?.() ?? randomUUID(),
      activePredicate,
      slot!.value,
      memoryId,
      // Message-level provenance lives on the memory's revision chain and
      // its creation event; the fact row keeps the memory reference.
      null,
      memory.created_at,
      Math.max(1, Math.min(100, memory.confidence)),
      predecessor?.id ?? null,
      memory.sensitivity,
      timeState,
      FACT_EXTRACTION_VERSION,
      now,
      now
    )
  }

  /** Startup catch-up: re-derive every memory's rows. Idempotent. */
  reindexAll(): number {
    const rows = this.options.database.connection.prepare('SELECT id FROM memories').all() as Array<{ id: string }>
    for (const row of rows) {
      try {
        this.reindexMemory(row.id)
      } catch {
        // One unreadable memory must not stop the index; the next pass retries.
      }
    }
    return rows.length
  }

  /**
   * Predicate-addressed lookup: the active facts for one predicate. Validity
   * is part of the query — superseded/retracted rows and expired values are
   * not current facts, whatever their text similarity.
   */
  lookupActive(predicate: string, options: { limit?: number; queryTime?: string; includeSuperseded?: boolean } = {}): FactRecord[] {
    // Valid-time filter: a present-tense question must not resurrect a past
    // fact; a past-tense question ("我以前住在哪里") may read superseded
    // history — that is what the audit layer keeps it for.
    const wantPast = options.queryTime === 'past'
    const statusClause = wantPast && options.includeSuperseded
      ? "fact_status IN ('active', 'superseded')"
      : "fact_status = 'active'"
    const timeClause = wantPast ? '1=1' : "time_state != 'past'"
    const rows = this.options.database.connection.prepare(`
      SELECT id, predicate, value, fact_status, source_memory_id, source_message_id, valid_from, valid_to, confidence, supersedes_fact_id, sensitivity
      FROM fact_records
      WHERE predicate = ? AND ${statusClause} AND valid_to IS NULL AND ${timeClause}
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(predicate, options.limit ?? 10) as Array<{ id: string; predicate: string; value: string; fact_status: string; source_memory_id: string; source_message_id: string | null; valid_from: string; valid_to: string | null; confidence: number; supersedes_fact_id: string | null; sensitivity: string }>
    return rows.map((row) => ({
      id: row.id,
      subject: 'user' as const,
      predicate: row.predicate,
      value: row.value,
      factStatus: row.fact_status as FactRecord['factStatus'],
      sourceMemoryId: row.source_memory_id,
      sourceMessageId: row.source_message_id,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      confidence: row.confidence,
      supersedesFactId: row.supersedes_fact_id,
      sensitivity: row.sensitivity as FactRecord['sensitivity']
    }))
  }

  counts(): { total: number; active: number } {
    const row = this.options.database.connection.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN fact_status = 'active' THEN 1 ELSE 0 END) AS active FROM fact_records"
    ).get() as { total: number; active: number | null }
    return { total: row.total, active: row.active ?? 0 }
  }
}

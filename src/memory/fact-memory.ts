/**
 * Addressable fact ledger over the existing memories (final closure, R1/R2).
 *
 * The memories table stays the single source of truth for text, revisions and
 * lifecycle. The ledger is *derived state*: every row cites the exact source
 * memory revision, and the whole table can be rebuilt from memories at any
 * time by the idempotent `reindexAll`. Because it is derived, the migration
 * ships it empty and startup repopulates it — there is no second truth to
 * migrate.
 *
 * R1: one memory yields 0..N facts — every clause of the current text is run
 * through the shared extractor, so "我住在杭州，猫叫豆豆" indexes two facts.
 * `source_revision` cites the memory revision the value was read from;
 * `valid_from` is that revision's effective time (updated_at), not the
 * memory's creation; `provenance_kind='legacy'` with `source_message_id=null`
 * says honestly that no message reference exists for memories created before
 * provenance was recorded — never a fabricated id.
 *
 * R2: a memory that is not `active` can never produce an active fact. The
 * guard runs before any INSERT, so a retracted memory re-indexing from an
 * empty ledger stays empty instead of resurrecting. Reindex failures are NOT
 * swallowed: `reindexMemory` throws, `MemoryService.reindexFact` records a
 * degradation event, and a failed re-index is retried on the next lifecycle
 * write and at startup.
 *
 * Supersede semantics: only an explicit correction of the same memory moves
 * its old rows to `superseded`. Two different memories asserting different
 * values for one predicate are conflict candidates for the evidence gate to
 * clarify — never an automatic overwrite.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import { extractFactSlots } from './fact-slot'

export const FACT_EXTRACTION_VERSION = 'fact-index-v2'

export interface FactRecord {
  id: string
  predicate: string
  valueDisplay: string
  valueNormalized: string
  polarity: 'positive' | 'negative'
  status: 'active' | 'superseded' | 'retracted'
  sourceMemoryId: string
  sourceRevision: number
  sourceMessageId: string | null
  provenanceKind: 'message' | 'legacy'
  validFrom: string
  validTo: string | null
  confidence: number
  sensitivity: 'normal' | 'personal' | 'sensitive'
  timeState: 'past' | 'present' | 'future' | 'unspecified'
}

interface MemoryRow {
  id: string
  current_text: string
  status: string
  revision: number
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
   * Re-derives the fact rows for one memory from its current text and
   * revision. Throws on storage failure — the caller decides whether that
   * degrades a turn or blocks a startup pass; silently losing index updates
   * is what created the resurrection hole in the first place.
   */
  reindexMemory(memoryId: string): void {
    try {
      this.reindexMemoryTransactional(memoryId)
      this.markJob(memoryId, 'indexed', this.clock())
    } catch (error) {
      // A: the failure is DURABLE (job row + bounded backoff), not swallowed —
      // and rethrown so the caller records its own degradation event.
      this.markDegraded(memoryId, error instanceof Error ? error.name : 'UNKNOWN')
      throw error
    }
  }

  /**
   * Durable degraded mark for a caller that owns recovery (the memory service).
   * reindexMemory already marks its own failures; this covers a failure raised
   * above this class (adapter or fault-injection layer) without double-counting
   * an attempt the class already recorded.
   */
  markDegradedJob(memoryId: string, errorCode: string): void {
    const row = this.options.database.connection.prepare(
      'SELECT status FROM fact_index_jobs WHERE memory_id = ?'
    ).get(memoryId) as { status: string } | undefined
    if (row?.status === 'degraded') return
    this.markDegraded(memoryId, errorCode)
  }

  /**
   * A: bounded exponential backoff for a degraded index job:
   * min(2^attempt × 5s, 15min). A job is retryable once next_retry_at has
   * passed; the cap keeps a permanently broken memory observable instead of
   * hot-looping. Returns the ids whose index actually recovered.
   */
  retryDue(memoryIds: readonly string[]): string[] {
    const now = this.clock()
    const retried: string[] = []
    for (const memoryId of memoryIds) {
      const job = this.options.database.connection.prepare(
        'SELECT status, attempt_count, next_retry_at FROM fact_index_jobs WHERE memory_id = ?'
      ).get(memoryId) as { status: string; attempt_count: number; next_retry_at: string | null } | undefined
      if (!job || job.status !== 'degraded') continue
      if (job.next_retry_at && job.next_retry_at > now) continue
      try {
        this.reindexMemoryTransactional(memoryId)
        this.markJob(memoryId, 'indexed', this.clock())
        retried.push(memoryId)
      } catch {
        this.markDegraded(memoryId, 'REINDEX_FAILED')
      }
    }
    return retried
  }

  private markJob(memoryId: string, status: 'indexed' | 'pending', at: string): void {
    this.options.database.connection.prepare(`
      INSERT INTO fact_index_jobs(memory_id, status, attempt_count, last_error_code, next_retry_at, updated_at)
      VALUES (?, ?, 0, NULL, NULL, ?)
      ON CONFLICT(memory_id) DO UPDATE SET status = excluded.status, attempt_count = 0, last_error_code = NULL, next_retry_at = NULL, updated_at = excluded.updated_at
    `).run(memoryId, status, at)
  }

  private markDegraded(memoryId: string, errorCode: string): void {
    const row = this.options.database.connection.prepare(
      'SELECT attempt_count FROM fact_index_jobs WHERE memory_id = ?'
    ).get(memoryId) as { attempt_count: number } | undefined
    const attempt = (row?.attempt_count ?? 0) + 1
    const backoffMs = Math.min(2 ** attempt * 5_000, 15 * 60_000)
    this.options.database.connection.prepare(`
      INSERT INTO fact_index_jobs(memory_id, status, attempt_count, last_error_code, next_retry_at, updated_at)
      VALUES (?, 'degraded', ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET status = 'degraded', attempt_count = excluded.attempt_count, last_error_code = excluded.last_error_code, next_retry_at = excluded.next_retry_at, updated_at = excluded.updated_at
    `).run(memoryId, attempt, errorCode.slice(0, 64), new Date(Date.parse(this.clock()) + backoffMs).toISOString(), this.clock())
  }

  /** A: degraded jobs surfaced for health checks and scheduled retries. */
  degradedJobs(): Array<{ memoryId: string; attemptCount: number; lastErrorCode: string | null }> {
    return this.options.database.connection.prepare(
      "SELECT memory_id, attempt_count, last_error_code FROM fact_index_jobs WHERE status = 'degraded' ORDER BY updated_at DESC LIMIT 50"
    ).all() as Array<{ memoryId: string; attemptCount: number; lastErrorCode: string | null }>
  }

  private reindexMemoryTransactional(memoryId: string): void {
    const memory = this.options.database.connection.prepare(
      'SELECT id, current_text, status, revision, sensitivity, confidence, created_at, updated_at FROM memories WHERE id = ?'
    ).get(memoryId) as MemoryRow | undefined
    if (!memory) return
    // B: message-level provenance comes from THIS revision's own record —
    // legacy rows keep null and say so, never a fabricated id.
    const revisionProvenance = this.options.database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM memory_revisions WHERE memory_id = ? AND revision = ?'
    ).get(memoryId, memory.revision) as { source_message_id: string | null; provenance_kind: string } | undefined
    const now = this.clock()
    const database = this.options.database.connection

    // database.transaction() is savepoint-aware: reindex is called from inside
    // the caller's message/operation transaction, where a raw BEGIN would throw.
    this.options.database.transaction(() => {
      // R2 guard first: a non-active memory can only carry retracted facts.
      if (memory.status !== 'active') {
        database.prepare(
          "UPDATE fact_records SET status = 'retracted', valid_to = ?, updated_at = ? WHERE source_memory_id = ? AND status != 'retracted'"
        ).run(now, now, memoryId)
        return
      }

      const candidates = extractFactSlots(memory.current_text)
      const existing = database.prepare(
        'SELECT id, predicate, value_normalized, polarity, status FROM fact_records WHERE source_memory_id = ?'
      ).all(memoryId) as Array<{ id: string; predicate: string; value_normalized: string; polarity: string; status: string }>

      for (const row of existing) {
        const stillCurrent = candidates.some((candidate) =>
          candidate.predicate === row.predicate && candidate.valueNormalized === row.value_normalized && candidate.polarity === row.polarity)
        // Only the lifecycle writes can close a row: a value that disappeared
        // because the memory was CORRECTED is superseded; rows cannot silently
        // vanish on a re-read.
        if (!stillCurrent && row.status === 'active') {
          database.prepare(
            "UPDATE fact_records SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?"
          ).run(now, now, row.id)
        } else if (stillCurrent && row.status !== 'active') {
          // A memory restored after a retraction: the row re-opens from its
          // own history instead of the history being rewritten.
          database.prepare(
            "UPDATE fact_records SET status = 'active', valid_to = NULL, updated_at = ? WHERE id = ?"
          ).run(now, row.id)
        }
      }

      for (const candidate of candidates) {
        const existingRow = existing.find((row) =>
          row.predicate === candidate.predicate && row.value_normalized === candidate.valueNormalized && row.polarity === candidate.polarity && row.status === 'active')
        if (existingRow) continue
        // Supersedes chain: only within the same memory + predicate, where the
        // correction semantics are unambiguous.
        const predecessor = database.prepare(
          "SELECT id FROM fact_records WHERE source_memory_id = ? AND predicate = ? AND status = 'superseded' ORDER BY updated_at DESC LIMIT 1"
        ).get(memoryId, candidate.predicate) as { id: string } | undefined
        database.prepare(`
          INSERT INTO fact_records(id, subject, predicate, value_display, value_normalized, polarity, status, source_memory_id, source_revision, source_message_id, provenance_kind, valid_from, valid_to, confidence, supersedes_fact_id, sensitivity, time_state, extraction_version, created_at, updated_at)
          VALUES (?, 'user', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_memory_id, source_revision, predicate, value_normalized, polarity) DO NOTHING
        `).run(
          this.options.makeId?.() ?? randomUUID(),
          candidate.predicate,
          candidate.value,
          candidate.valueNormalized,
          candidate.polarity,
          memoryId,
          memory.revision,
          revisionProvenance?.source_message_id ?? null,
          revisionProvenance?.provenance_kind === 'message' ? 'message' : 'legacy',
          memory.updated_at,
          Math.max(1, Math.min(100, memory.confidence)),
          predecessor?.id ?? null,
          memory.sensitivity,
          candidate.time,
          FACT_EXTRACTION_VERSION,
          now,
          now
        )
      }
    })
  }

  /** Startup catch-up: re-derive every memory's rows. Idempotent, throwing. */
  reindexAll(): { total: number; failed: number } {
    const rows = this.options.database.connection.prepare('SELECT id FROM memories').all() as Array<{ id: string }>
    let failed = 0
    for (const row of rows) {
      try {
        this.reindexMemory(row.id)
      } catch {
        failed += 1
      }
    }
    return { total: rows.length, failed }
  }

  /**
   * Predicate-addressed lookup. Valid-time and status filters are part of the
   * WHERE clause: a present-tense question never sees past or superseded rows,
   * a past-tense question may read superseded history (the audit layer).
   */
  lookupActive(predicate: string, options: { limit?: number; queryTime?: string; includeSuperseded?: boolean } = {}): FactRecord[] {
    // A past-tense read is exactly the case that may see superseded history;
    // includeSuperseded can only narrow it, never widen a current read.
    const wantPast = options.queryTime === 'past'
    const includeSuperseded = wantPast && options.includeSuperseded !== false
    const statusClause = includeSuperseded
      ? "status IN ('active', 'superseded')"
      : "status = 'active'"
    // A historical read sees the superseded value that a current read must not:
    // superseded rows carry valid_to, so the current-only clause cannot simply
    // be reused with a wider status list.
    const validClause = includeSuperseded ? '1=1' : 'valid_to IS NULL'
    const timeClause = wantPast ? '1=1' : "time_state != 'past'"
    const rows = this.options.database.connection.prepare(`
      SELECT id, predicate, value_display, value_normalized, polarity, status, source_memory_id, source_revision, source_message_id, provenance_kind, valid_from, valid_to, confidence, sensitivity, time_state
      FROM fact_records
      WHERE predicate = ? AND ${statusClause} AND ${validClause} AND ${timeClause}
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(predicate, options.limit ?? 10) as Array<{ id: string; predicate: string; value_display: string; value_normalized: string; polarity: string; status: string; source_memory_id: string; source_revision: number; source_message_id: string | null; provenance_kind: string; valid_from: string; valid_to: string | null; confidence: number; sensitivity: string; time_state: string }>
    return rows.map((row) => ({
      id: row.id,
      predicate: row.predicate,
      valueDisplay: row.value_display,
      valueNormalized: row.value_normalized,
      polarity: row.polarity as FactRecord['polarity'],
      status: row.status as FactRecord['status'],
      sourceMemoryId: row.source_memory_id,
      sourceRevision: row.source_revision,
      sourceMessageId: row.source_message_id,
      provenanceKind: row.provenance_kind as FactRecord['provenanceKind'],
      validFrom: row.valid_from,
      validTo: row.valid_to,
      confidence: row.confidence,
      sensitivity: row.sensitivity as FactRecord['sensitivity'],
      timeState: row.time_state as FactRecord['timeState']
    }))
  }

  /** Superseded values of the given memories (history questions only). */
  supersededFor(memoryIds: readonly string[]): Array<{ predicate: string; value: string }> {
    if (memoryIds.length === 0) return []
    const placeholders = memoryIds.map(() => '?').join(',')
    const rows = this.options.database.connection.prepare(
      `SELECT predicate, value_display FROM fact_records WHERE status = 'superseded' AND source_memory_id IN (${placeholders}) ORDER BY updated_at DESC LIMIT 10`
    ).all(...memoryIds) as Array<{ predicate: string; value_display: string }>
    return rows.map((row) => ({ predicate: row.predicate, value: row.value_display }))
  }

  /** Runs a batch inside one transaction on the same connection. */
  inTransaction<T>(operation: () => T): T {
    return this.options.database.transaction(operation)
  }

  counts(): { total: number; active: number } {
    const row = this.options.database.connection.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM fact_records"
    ).get() as { total: number; active: number | null }
    return { total: row.total, active: row.active ?? 0 }
  }
}

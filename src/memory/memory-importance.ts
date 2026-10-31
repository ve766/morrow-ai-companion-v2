/**
 * Memory importance, consolidation and decay (Stage 3 §2A).
 *
 * The question this answers is not "how often was it mentioned". A memory that
 * the user stated once and explicitly marked as important must outlive one that
 * came up five times in passing, and a corrected fact must outlive both.
 *
 *   I(m) = clip( w_src·S + w_user·U + w_rep·R + w_goal·G + w_corr·C + w_rec·T , 0, 1 )
 *
 * | term | meaning | range | source |
 * |---|---|---|---|
 * | S | provenance reliability | 1.0 explicit / 0.7 accepted suggestion / 0.5 turn-derived | `source_category` |
 * | U | explicit importance marker ("记住""重要""务必") | 0 / 1 | memory text |
 * | R | repeated independent mentions | `1 − e^(−n/3)` | revision history |
 * | G | linked to a stated goal | 0 / 1 | memory text |
 * | C | corrected at least once | 0 / 1 | revision history |
 * | T | recency, `0.5^(age_days/90)` | 0 / 1 | `updated_at` |
 *
 * Weights: `w_src=.30 w_user=.25 w_rep=.15 w_goal=.10 w_corr=.10 w_rec=.10`.
 *
 * Three consequences are deliberate:
 *
 * 1. **Decay is not deletion.** A memory whose score falls below the archive
 *    threshold gets `archived_at` and stops competing for retrieval. The row,
 *    its revisions and its provenance stay; `restore()` brings it back.
 * 2. **Some memories are protected.** An explicitly important memory, a
 *    corrected one, or one tied to a goal is never auto-archived, however old.
 * 3. **Consolidation references, never copies.** Two memories that state the
 *    same slot/value are grouped into one consolidation row that lists their
 *    ids. No chat text is duplicated into a new record.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import { readFactSlot } from './fact-slot'
import type { MemoryRecord, MemorySourceCategory } from './memory-domain'

export const IMPORTANCE_VERSION = 'memory.importance.v1'
export const IMPORTANCE_WEIGHTS = Object.freeze({ source: 0.3, explicit: 0.25, repetition: 0.15, goal: 0.1, correction: 0.1, recency: 0.1 })
/** Below this score a memory is a candidate for archival. */
export const ARCHIVE_THRESHOLD = 0.35
/** Recency half-life in days. */
export const RECENCY_HALF_LIFE_DAYS = 90

const SOURCE_RELIABILITY: Readonly<Record<MemorySourceCategory, number>> = Object.freeze({
  user_explicit_input: 1,
  model_inferred_confirmed: 0.7,
  turn_derived_confirmed: 0.5
})

const EXPLICIT_MARKERS = /(?:记住|重要|务必|一定|关键|别忘了|must remember|important|critical)/iu
const GOAL_MARKERS = /(?:目标|计划|打算|准备|想完成|goal|plan|intend to)/iu
// Boundaries and identity facts are the memories that must survive time. They
// get a one-year half-life instead of the default ninety days.
const BOUNDARY_MARKERS = /(?:过敏|忌口|不能吃|禁止|边界|底线|信仰|原则|allerg|intoleran|never tell|boundary|my values)/iu

export interface ImportanceComponents {
  source: number
  explicit: number
  repetition: number
  goal: number
  correction: number
  recency: number
}

export interface ImportanceResult {
  score: number
  components: ImportanceComponents
  /** True when the memory may never be auto-archived. */
  protected: boolean
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number): number {
  const rounded = Number(value.toFixed(4))
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Pure scoring function; no database, so it can be tested and replayed. */
export function scoreMemory(input: {
  record: Pick<MemoryRecord, 'currentText' | 'sourceCategory' | 'updatedAt' | 'revision'>
  /**
   * Independent mentions, from the evidence ledger.
   *
   * Deliberately NOT `revision - 1`: a revision is an edit, and an edited memory
   * has not been mentioned more often. When the caller has no ledger rows this
   * is 0 rather than a guess.
   */
  extraMentions?: number
  corrected?: boolean
  now: string
  /** Overrides the default half-life; see `halfLifeDaysFor`. */
  halfLifeDays?: number
}): ImportanceResult {
  const text = input.record.currentText
  const source = SOURCE_RELIABILITY[input.record.sourceCategory] ?? 0.5
  const explicit = EXPLICIT_MARKERS.test(text) ? 1 : 0
  const goal = GOAL_MARKERS.test(text) ? 1 : 0
  const correction = input.corrected ? 1 : 0
  const mentions = Math.max(0, input.extraMentions ?? 0)
  const repetition = 1 - Math.exp(-mentions / 3)
  const ageDays = Math.max(0, (Date.parse(input.now) - Date.parse(input.record.updatedAt)) / 86_400_000)
  const halfLife = input.halfLifeDays ?? halfLifeDaysFor(text, input.record.sourceCategory)
  const recency = Number.isFinite(ageDays) && halfLife > 0 ? 0.5 ** (ageDays / halfLife) : 0

  const score = clamp01(
    IMPORTANCE_WEIGHTS.source * source +
    IMPORTANCE_WEIGHTS.explicit * explicit +
    IMPORTANCE_WEIGHTS.repetition * repetition +
    IMPORTANCE_WEIGHTS.goal * goal +
    IMPORTANCE_WEIGHTS.correction * correction +
    IMPORTANCE_WEIGHTS.recency * recency
  )
  return {
    score: round(score),
    components: {
      source: round(source),
      explicit,
      repetition: round(repetition),
      goal,
      correction,
      recency: round(recency)
    },
    // A user-stated important fact, a corrected fact and a goal-linked fact are
    // never archived by time alone.
    protected: explicit === 1 || correction === 1 || goal === 1
  }
}

export interface MemoryEvidenceInput {
  memoryId: string
  sourceRef: string
  sourceKind: 'message' | 'turn' | 'user_explicit' | 'migration'
  actor: 'user' | 'morrow' | 'system'
  conversationId: string | null
  evidenceType:
    | 'statement'
    | 'restatement'
    | 'correction'
    | 'confirmation'
    | 'goal_link'
    | 'boundary'
    | 'retraction'
    | 'model_reference'
  confidence: number
  /** Two rows in the same group are one context, not two independent mentions. */
  independenceGroup: string
}

export interface MemoryImportancePort {
  onMemoryChanged(memoryId: string): void
  onMemoryRemoved(memoryId: string): void
  /** Appends to the evidence ledger; the score is derived from it, not incremented. */
  recordEvidence?(input: MemoryEvidenceInput): void
  /** Cached importance for ranking. Absent implementations rank without it. */
  scoreOf?(memoryId: string): number
}

/**
 * Half-life by memory kind.
 *
 * One 90-day half-life for everything was the bug: it let "I am allergic to
 * peanuts" fade exactly as fast as "I had a sandwich on Tuesday". Boundaries and
 * identity facts decay slowly; incidental events decay quickly.
 */
export function halfLifeDaysFor(text: string, sourceCategory: string): number {
  if (BOUNDARY_MARKERS.test(text)) return 365
  if (GOAL_MARKERS.test(text)) return 180
  if (sourceCategory === 'user_explicit_input') return 180
  return RECENCY_HALF_LIFE_DAYS
}

export class MemoryImportanceService implements MemoryImportancePort {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  /** Recomputes one memory from its revisions and caches the result. */
  recompute(memoryId: string): ImportanceResult | null {
    const row = this.database.connection.prepare(
      'SELECT id, current_text, source_category, status, updated_at, revision FROM memories WHERE id = ?'
    ).get(memoryId) as { id: string; current_text: string; source_category: MemorySourceCategory; status: string; updated_at: string; revision: number } | undefined
    if (!row) return null
    const corrected = Number((this.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM memory_revisions WHERE memory_id = ? AND change_type = 'corrected'"
    ).get(memoryId) as { n: number }).n) > 0
    // Independent restatements, from the ledger. Corrections are evidence of
    // importance, not of repetition: being corrected twice does not mean the
    // fact was mentioned twice in the same sense. A memory that is no longer
    // active has no repetition standing at all — a retraction suppresses the
    // contributions rather than leaving them to keep the score up.
    const restatements = row.status === 'active'
      ? Number((this.database.connection.prepare(
          "SELECT COUNT(DISTINCT independence_group) AS n FROM memory_evidence WHERE memory_id = ? AND evidence_type = 'restatement' AND retracted_at IS NULL"
        ).get(memoryId) as { n: number }).n)
      : 0
    const result = scoreMemory({
      record: { currentText: row.current_text, sourceCategory: row.source_category, updatedAt: row.updated_at, revision: row.revision },
      extraMentions: restatements,
      corrected,
      now: this.clock()
    })
    this.database.connection.prepare(`
      INSERT INTO memory_importance(memory_id, score, components_json, version, computed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        score = excluded.score,
        components_json = excluded.components_json,
        version = excluded.version,
        computed_at = excluded.computed_at
    `).run(memoryId, result.score, JSON.stringify(result.components), IMPORTANCE_VERSION, this.clock())
    return result
  }

  /**
   * Appends one row to the evidence ledger.
   *
   * Idempotent on `(memory_id, source_ref)`, so a retried turn or a repeated
   * correction contributes once.
   */
  recordEvidence(input: MemoryEvidenceInput): void {
    this.database.connection.prepare(`
      INSERT INTO memory_evidence(memory_id, source_ref, source_kind, actor, conversation_id, occurred_at, evidence_type, confidence, independence_group, algorithm_version, retracted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(memory_id, source_ref) DO NOTHING
    `).run(
      input.memoryId, input.sourceRef, input.sourceKind, input.actor, input.conversationId,
      this.clock(), input.evidenceType, Math.max(0, Math.min(1, input.confidence)), input.independenceGroup,
      IMPORTANCE_VERSION
    )
  }

  /** Cached score for ranking; 0 when it was never computed. */
  scoreOf(memoryId: string): number {
    const row = this.database.connection.prepare('SELECT score FROM memory_importance WHERE memory_id = ?').get(memoryId) as { score: number } | undefined
    return typeof row?.score === 'number' ? row.score : 0
  }

  recomputeAll(): number {
    const ids = this.database.connection.prepare("SELECT id FROM memories WHERE status = 'active'").all() as Array<{ id: string }>
    for (const row of ids) this.recompute(row.id)
    return ids.length
  }

  get(memoryId: string): { score: number; components: ImportanceComponents; computedAt: string } | null {
    const row = this.database.connection.prepare(
      'SELECT score, components_json, computed_at FROM memory_importance WHERE memory_id = ?'
    ).get(memoryId) as { score: number; components_json: string; computed_at: string } | undefined
    if (!row) return null
    return { score: row.score, components: JSON.parse(row.components_json) as ImportanceComponents, computedAt: row.computed_at }
  }

  /**
   * Archives memories that are both low-importance and unprotected.
   *
   * Returns the ids it archived. Nothing is deleted: `archived_at` only removes
   * the memory from retrieval competition.
   */
  archiveBelow(threshold = ARCHIVE_THRESHOLD, olderThanDays = 0): string[] {
    this.recomputeAll()
    const nowMs = Date.parse(this.clock())
    const rows = this.database.connection.prepare(`
      SELECT m.id, m.updated_at, i.score, i.components_json
      FROM memories m JOIN memory_importance i ON i.memory_id = m.id
      WHERE m.status = 'active' AND m.archived_at IS NULL
    `).all() as Array<{ id: string; updated_at: string; score: number; components_json: string }>
    const archived: string[] = []
    const at = this.clock()
    for (const row of rows) {
      if (olderThanDays > 0) {
        const updatedMs = Date.parse(row.updated_at)
        if (!Number.isFinite(updatedMs) || nowMs - updatedMs < olderThanDays * 86_400_000) continue
      }
      const components = JSON.parse(row.components_json) as ImportanceComponents
      const protectedMemory = components.explicit === 1 || components.correction === 1 || components.goal === 1
      if (protectedMemory || row.score >= threshold) continue
      this.database.connection.prepare('UPDATE memories SET archived_at = ?, updated_at = ? WHERE id = ?').run(at, at, row.id)
      archived.push(row.id)
    }
    return archived
  }

  /** Undoes an archival without touching the content or the revisions. */
  restore(memoryId: string): boolean {
    const result = this.database.connection.prepare('UPDATE memories SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL').run(this.clock(), memoryId)
    return Number(result.changes) > 0
  }

  /**
   * Groups active memories that state the same slot and value.
   *
   * The consolidation row stores member ids, never a copy of the text: the
   * memories stay the only source of truth, and deleting one only shortens the
   * member list on the next consolidation pass.
   */
  consolidate(): Array<{ slotKey: string; memberIds: string[] }> {
    const rows = this.database.connection.prepare(
      "SELECT id, current_text FROM memories WHERE status = 'active' AND archived_at IS NULL"
    ).all() as Array<{ id: string; current_text: string }>
    const groups = new Map<string, string[]>()
    for (const row of rows) {
      const slot = readFactSlot(row.current_text)
      if (!slot || slot.value === null || slot.value.length === 0) continue
      const key = `${slot.predicate}=${slot.value}`
      const members = groups.get(key) ?? []
      members.push(row.id)
      groups.set(key, members)
    }
    const result: Array<{ slotKey: string; memberIds: string[] }> = []
    const at = this.clock()
    for (const [slotKey, memberIds] of groups) {
      if (memberIds.length < 2) continue
      this.database.connection.prepare(`
        INSERT INTO memory_consolidations(id, slot_key, member_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(slot_key) DO UPDATE SET
          member_ids_json = excluded.member_ids_json,
          updated_at = excluded.updated_at
      `).run(this.makeId(), slotKey, JSON.stringify(memberIds.sort()), at, at)
      result.push({ slotKey, memberIds })
    }
    return result
  }

  /** Consolidation groups whose members still all exist and are active. */
  consolidations(): Array<{ slotKey: string; memberIds: string[]; updatedAt: string }> {
    const rows = this.database.connection.prepare(
      'SELECT slot_key, member_ids_json, updated_at FROM memory_consolidations ORDER BY updated_at DESC'
    ).all() as Array<{ slot_key: string; member_ids_json: string; updated_at: string }>
    const active = new Set((this.database.connection.prepare(
      "SELECT id FROM memories WHERE status = 'active' AND archived_at IS NULL"
    ).all() as Array<{ id: string }>).map((row) => row.id))
    return rows
      .map((row) => ({ slotKey: row.slot_key, memberIds: (JSON.parse(row.member_ids_json) as string[]).filter((id) => active.has(id)), updatedAt: row.updated_at }))
      .filter((group) => group.memberIds.length >= 2)
  }

  onMemoryChanged(memoryId: string): void {
    this.recompute(memoryId)
  }

  onMemoryRemoved(memoryId: string): void {
    this.database.connection.prepare('DELETE FROM memory_importance WHERE memory_id = ?').run(memoryId)
  }
}

/**
 * Bounded personalization state (Stage 2, algorithm B2).
 *
 * Rule: `p' = clip(p + eta * w * e, min, max)` with
 *   - `p`  the current value of one named dimension,
 *   - `eta` the learning rate (PERSONALIZATION_ETA = 0.05),
 *   - `w`  evidence reliability, normalized to [0, 1] at the service boundary,
 *   - `e`  the signed signal, normalized to [-1, 1] at the same boundary.
 *
 * Three invariants make the value trustworthy:
 *
 *   1. **Evidence is the source of truth.** `personalization_signals` holds one
 *      row per (dimension, turn). `personalization_state` is a cache that is
 *      always recomputed from those rows, never incremented on its own. If a
 *      source message is deleted and its signals disappear, the next read
 *      recomputes the value from what is left — a stale number cannot survive
 *      in the prompt.
 *   2. **Apply is atomic.** Signal insert and state write happen in one
 *      transaction, so a crash cannot leave "signal exists, state did not move".
 *      Retrying the same turn converges because the recompute is a fold over
 *      evidence, not an increment.
 *   3. **Normalization happens once, before both the calculation and the
 *      write.** The database CHECK constraints and the arithmetic therefore see
 *      the same numbers.
 *
 * This is a heuristic engineering state, not a psychological measurement, and
 * the prompt block says so.
 */
import type { SqliteDatabase } from '../persistence/database'

export const PERSONALIZATION_ETA = 0.05
export const PERSONALIZATION_MIN = 0
export const PERSONALIZATION_MAX = 1
/** Neutral midpoint: nothing has been learned yet. */
export const PERSONALIZATION_NEUTRAL = 0.5

export const PERSONALIZATION_DIMENSIONS = ['exploration', 'depth', 'pace'] as const
export type PersonalizationDimension = typeof PERSONALIZATION_DIMENSIONS[number]

export interface PersonalizationEntry {
  dimension: PersonalizationDimension
  value: number
  evidenceCount: number
  revision: number
  updatedAt: string
  /** Turn that produced the current value; null when no evidence remains. */
  lastTurnId: string | null
}

export interface PersonalizationSignal {
  dimension: PersonalizationDimension
  /** Signed contribution; clamped to [-1, 1] before use and before storage. */
  signal: number
  /** Evidence reliability; clamped to [0, 1] before use and before storage. */
  weight: number
  turnId: string
  at: string
}

export function boundedUpdate(current: number, signal: number, weight: number, eta = PERSONALIZATION_ETA): number {
  const w = Math.min(1, Math.max(0, weight))
  const e = Math.min(1, Math.max(-1, signal))
  const next = current + eta * w * e
  return Math.min(PERSONALIZATION_MAX, Math.max(PERSONALIZATION_MIN, next))
}

function round(value: number): number {
  const rounded = Number(value.toFixed(4))
  return Object.is(rounded, -0) ? 0 : rounded
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * Terms that mark a saved memory as being *about* one interaction dimension.
 *
 * B3's `P` term is "preference/personality fit". Without a mapping from a fact to
 * a preference, that term can only be faked, so the mapping is deliberately
 * narrow: a memory that explicitly talks about length/depth, pacing or breadth is
 * the kind of fact a personalised dimension should promote. Anything else gets 0.
 */
const DIMENSION_TERMS: Readonly<Record<PersonalizationDimension, readonly string[]>> = Object.freeze({
  depth: Object.freeze(['详细', '简洁', '简短', '深入', '细节', '说短', '说长', 'detail', 'concise', 'brief', 'elaborate']),
  pace: Object.freeze(['一步一步', '节奏', '慢一点', '快一点', '别急', 'pace', 'step by step', 'slower', 'faster']),
  exploration: Object.freeze(['多给几个', '几个方案', '选项', '发散', '探索', 'brainstorm', 'options', 'alternatives', 'explore'])
})

/**
 * How much a memory is about a dimension the user has actually personalised.
 *
 * Returns 0 when the memory names no dimension term, and 0 when the dimension
 * has no evidence (an untouched 0.5 is not a preference). Otherwise the value is
 * the distance from the neutral baseline, scaled to [0, 1] — a dimension the user
 * pushed hard to one side boosts its related memories most.
 */
export function personalizationFit(text: string, entries: readonly PersonalizationEntry[]): number {
  const normalized = text.toLowerCase()
  let best = 0
  for (const entry of entries) {
    if (entry.evidenceCount <= 0) continue
    const terms = DIMENSION_TERMS[entry.dimension]
    if (!terms.some((term) => normalized.includes(term))) continue
    best = Math.max(best, Math.min(1, Math.abs(entry.value - 0.5) * 2))
  }
  return best
}

export class PersonalizationService {
  constructor(private readonly database: SqliteDatabase, private readonly clock: () => string = () => new Date().toISOString()) {}

  /**
   * Reads a dimension by folding its evidence. The cached row is repaired when
   * it disagrees with the evidence, so a deletion that only removed signals
   * cannot leave a value behind that no longer has support.
   */
  get(dimension: PersonalizationDimension): PersonalizationEntry {
    return this.recompute(dimension, { persist: true })
  }

  list(): PersonalizationEntry[] {
    return PERSONALIZATION_DIMENSIONS.map((dimension) => this.get(dimension))
  }

  /**
   * Applies one signal atomically.
   *
   * Normalization happens first (P1-C), then insert + recompute happen inside a
   * single `BEGIN IMMEDIATE` transaction (P1-B). The result is a fold over all
   * signals for the dimension, so replaying a turn, or recovering from a crash
   * that left a signal without a state row, converges to the same value.
   */
  apply(input: PersonalizationSignal): PersonalizationEntry {
    if (typeof input.turnId !== 'string' || !uuidPattern.test(input.turnId)) throw new TypeError('Personalization requires a valid turn id.')
    if (!PERSONALIZATION_DIMENSIONS.includes(input.dimension)) throw new TypeError('Unknown personalization dimension.')
    if (!Number.isFinite(input.signal) || !Number.isFinite(input.weight)) throw new TypeError('Personalization requires finite signal and weight.')
    if (typeof input.at !== 'string' || !Number.isFinite(Date.parse(input.at))) throw new TypeError('Personalization requires a valid timestamp.')

    const turnId = input.turnId.toLowerCase()
    const signal = Math.min(1, Math.max(-1, input.signal))
    const weight = Math.min(1, Math.max(0, input.weight))

    this.database.connection.exec('BEGIN IMMEDIATE')
    try {
      this.database.connection.prepare(`
        INSERT INTO personalization_signals(dimension, turn_id, signal, weight, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(dimension, turn_id) DO NOTHING
      `).run(input.dimension, turnId, signal, weight, input.at)

      const entry = this.fold(input.dimension)
      this.writeState(entry, input.at, { bumpRevision: true })
      this.database.connection.exec('COMMIT')
      return entry
    } catch (error) {
      try {
        this.database.connection.exec('ROLLBACK')
      } catch {
        // The transaction is already gone; surface the original failure.
      }
      throw error
    }
  }

  /**
   * Withdraws every signal produced by one turn and recomputes the dimensions
   * that were affected. Deletion paths that cannot run this can simply delete
   * the signals: the next `get()` recomputes from evidence anyway.
   */
  forgetTurn(turnId: string): PersonalizationEntry[] {
    const id = turnId.toLowerCase()
    const affected = this.database.connection.prepare(
      'SELECT DISTINCT dimension FROM personalization_signals WHERE turn_id = ?'
    ).all(id) as Array<{ dimension: PersonalizationDimension }>
    this.database.connection.prepare('DELETE FROM personalization_signals WHERE turn_id = ?').run(id)
    return affected.map((row) => this.recompute(row.dimension, { persist: true }))
  }

  /** Rebuilds every cached row from evidence; used by the consistency check. */
  recomputeAll(): PersonalizationEntry[] {
    return PERSONALIZATION_DIMENSIONS.map((dimension) => this.recompute(dimension, { persist: true }))
  }

  private recompute(dimension: PersonalizationDimension, options: { persist: boolean }): PersonalizationEntry {
    const entry = this.fold(dimension)
    if (options.persist) this.writeState(entry, this.clock(), { bumpRevision: false })
    return entry
  }

  private fold(dimension: PersonalizationDimension): PersonalizationEntry {
    const rows = this.database.connection.prepare(
      'SELECT signal, weight, turn_id, created_at FROM personalization_signals WHERE dimension = ? ORDER BY created_at, turn_id'
    ).all(dimension) as Array<{ signal: number; weight: number; turn_id: string; created_at: string }>
    let value = PERSONALIZATION_NEUTRAL
    for (const row of rows) value = boundedUpdate(value, row.signal, row.weight)
    const cached = this.database.connection.prepare(
      'SELECT revision, updated_at FROM personalization_state WHERE dimension = ?'
    ).get(dimension) as { revision: number; updated_at: string } | undefined
    const last = rows.at(-1)
    return {
      dimension,
      value: round(value),
      evidenceCount: rows.length,
      revision: cached?.revision ?? 0,
      updatedAt: last?.created_at ?? cached?.updated_at ?? this.clock(),
      lastTurnId: last?.turn_id ?? null
    }
  }

  private writeState(entry: PersonalizationEntry, at: string, options: { bumpRevision: boolean }): void {
    this.database.connection.prepare(`
      INSERT INTO personalization_state(dimension, value, evidence_count, revision, updated_at, last_turn_id)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(dimension) DO UPDATE SET
        value = excluded.value,
        evidence_count = excluded.evidence_count,
        revision = personalization_state.revision + ?,
        updated_at = excluded.updated_at,
        last_turn_id = excluded.last_turn_id
    `).run(entry.dimension, entry.value, entry.evidenceCount, at, entry.lastTurnId, options.bumpRevision ? 1 : 0)
  }
}

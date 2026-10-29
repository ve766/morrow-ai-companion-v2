/**
 * Bounded personalization state (Stage 2, algorithm B2).
 *
 * The rule is `p' = clip(p + eta * w * e, min, max)` with:
 *   - `p`   current value of one named dimension,
 *   - `eta` the learning rate (default 0.05, see PERSONALIZATION_ETA),
 *   - `w`   evidence reliability in [0, 1] — how much this turn is trusted,
 *   - `e`   the signed signal in [-1, 1] this turn contributes.
 *
 * Two properties matter more than the formula:
 *
 *   1. A single turn can move a dimension by at most `eta` (0.05). Personality
 *      is not rewritten by one message; it drifts only under repeated evidence.
 *   2. Every update names the turn that produced it, so a value can be traced
 *      back to the turns that built it and recomputed after a deletion.
 *
 * This is a heuristic engineering state, not a psychological measurement, and
 * the prompt block says so.
 */
import type { SqliteDatabase } from '../persistence/database'

export const PERSONALIZATION_ETA = 0.05
export const PERSONALIZATION_MIN = 0
export const PERSONALIZATION_MAX = 1

export const PERSONALIZATION_DIMENSIONS = ['exploration', 'depth', 'pace'] as const
export type PersonalizationDimension = typeof PERSONALIZATION_DIMENSIONS[number]

export interface PersonalizationEntry {
  dimension: PersonalizationDimension
  value: number
  evidenceCount: number
  revision: number
  updatedAt: string
  /** Turn that produced the current value; null when the row is at its default. */
  lastTurnId: string | null
}

export interface PersonalizationSignal {
  dimension: PersonalizationDimension
  /** Signed contribution in [-1, 1]. */
  signal: number
  /** Evidence reliability in [0, 1]. */
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

export class PersonalizationService {
  constructor(private readonly database: SqliteDatabase, private readonly clock: () => string = () => new Date().toISOString()) {}

  /** Defaults are the neutral midpoint, not zero: nothing has been learned yet. */
  get(dimension: PersonalizationDimension): PersonalizationEntry {
    const row = this.database.connection.prepare(
      'SELECT dimension, value, evidence_count, revision, updated_at, last_turn_id FROM personalization_state WHERE dimension = ?'
    ).get(dimension) as { dimension: string; value: number; evidence_count: number; revision: number; updated_at: string; last_turn_id: string | null } | undefined
    if (!row) {
      return { dimension, value: 0.5, evidenceCount: 0, revision: 0, updatedAt: this.clock(), lastTurnId: null }
    }
    return {
      dimension: row.dimension as PersonalizationDimension,
      value: row.value,
      evidenceCount: row.evidence_count,
      revision: row.revision,
      updatedAt: row.updated_at,
      lastTurnId: row.last_turn_id
    }
  }

  list(): PersonalizationEntry[] {
    return PERSONALIZATION_DIMENSIONS.map((dimension) => this.get(dimension))
  }

  /**
   * Applies one signal. Idempotent per (dimension, turn): replaying the same
   * turn cannot move the value twice, which is what makes recovery safe.
   */
  apply(signal: PersonalizationSignal): PersonalizationEntry {
    if (!uuidPattern.test(signal.turnId)) throw new TypeError('Personalization requires a valid turn id.')
    if (!PERSONALIZATION_DIMENSIONS.includes(signal.dimension)) throw new TypeError('Unknown personalization dimension.')
    if (!Number.isFinite(signal.signal) || !Number.isFinite(signal.weight)) throw new TypeError('Personalization requires finite signal and weight.')

    const replay = this.database.connection.prepare(
      'SELECT 1 AS seen FROM personalization_signals WHERE dimension = ? AND turn_id = ?'
    ).get(signal.dimension, signal.turnId.toLowerCase())
    if (replay) return this.get(signal.dimension)

    const current = this.get(signal.dimension)
    const value = round(boundedUpdate(current.value, signal.signal, signal.weight))
    const at = signal.at

    this.database.connection.prepare(`
      INSERT INTO personalization_signals(dimension, turn_id, signal, weight, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(dimension, turn_id) DO NOTHING
    `).run(signal.dimension, signal.turnId.toLowerCase(), signal.signal, signal.weight, at)

    this.database.connection.prepare(`
      INSERT INTO personalization_state(dimension, value, evidence_count, revision, updated_at, last_turn_id)
      VALUES (?, ?, 1, 1, ?, ?)
      ON CONFLICT(dimension) DO UPDATE SET
        value = excluded.value,
        evidence_count = personalization_state.evidence_count + 1,
        revision = personalization_state.revision + 1,
        updated_at = excluded.updated_at,
        last_turn_id = excluded.last_turn_id
    `).run(signal.dimension, value, at, signal.turnId.toLowerCase())

    return this.get(signal.dimension)
  }

  /**
   * Removes the signals produced by one turn and recomputes the affected
   * dimensions from the signals that remain, so deleting a turn does not leave
   * a value that was built from it.
   */
  forgetTurn(turnId: string): PersonalizationEntry[] {
    const id = turnId.toLowerCase()
    const affected = this.database.connection.prepare(
      'SELECT DISTINCT dimension FROM personalization_signals WHERE turn_id = ?'
    ).all(id) as Array<{ dimension: PersonalizationDimension }>
    this.database.connection.prepare('DELETE FROM personalization_signals WHERE turn_id = ?').run(id)
    for (const { dimension } of affected) this.recompute(dimension)
    return affected.map((row) => this.get(row.dimension))
  }

  private recompute(dimension: PersonalizationDimension): void {
    const rows = this.database.connection.prepare(
      'SELECT signal, weight, turn_id, created_at FROM personalization_signals WHERE dimension = ? ORDER BY created_at, turn_id'
    ).all(dimension) as Array<{ signal: number; weight: number; turn_id: string; created_at: string }>
    let value = 0.5
    for (const row of rows) value = boundedUpdate(value, row.signal, row.weight)
    const last = rows.at(-1)
    this.database.connection.prepare(`
      INSERT INTO personalization_state(dimension, value, evidence_count, revision, updated_at, last_turn_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(dimension) DO UPDATE SET
        value = excluded.value,
        evidence_count = excluded.evidence_count,
        revision = personalization_state.revision + 1,
        updated_at = excluded.updated_at,
        last_turn_id = excluded.last_turn_id
    `).run(dimension, round(value), rows.length, 1, this.clock(), last?.turn_id ?? null)
  }
}

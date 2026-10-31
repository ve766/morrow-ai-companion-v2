import type { SqliteDatabase } from '../persistence/database'
import {
  GROWTH_DIMENSIONS,
  foldGrowth,
  type GrowthDimension,
  type GrowthSignalRow
} from './personality-growth'

/**
 * How this user wants Morrow to talk to them.
 *
 * This is deliberately *not* Morrow's personality. "说话直接一点" is a request
 * about presentation; it says nothing about what Morrow values, how she judges,
 * or what she is interested in. Keeping the two in one table made the product
 * claim a personality change every time someone asked for shorter answers.
 *
 * So:
 *   - `personality_profiles` is Morrow's identity. Only the user can edit it,
 *     and nothing in the turn path writes it.
 *   - this table is the interaction profile. It moves from explicit style
 *     requests, is bounded, and only affects how a reply is phrased.
 *
 * The fold is the same bounded, decaying arithmetic the identity channel uses —
 * reuse rather than a second implementation that can drift.
 */
export interface InteractionEntry {
  dimension: GrowthDimension
  /** The identity value this offset is applied to. */
  baseline: number
  offset: number
  evidenceCount: number
  updatedAt: string
}

export interface InteractionSignalInput {
  dimension: GrowthDimension
  signal: number
  weight: number
  source: string
  turnId: string
  at: string
}

interface ProfileRow {
  dimension: string
  baseline: number
  offset: number
  evidence_count: number
  updated_at: string
}

export const INTERACTION_ALGORITHM_VERSION = 'interaction-profile.v1'

export class UserInteractionProfileService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly baselineOf: () => Record<GrowthDimension, number>,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  /** One row per dimension, seeded from the identity baseline on first read. */
  list(): InteractionEntry[] {
    const existing = this.database.connection.prepare(
      'SELECT dimension, baseline, offset, evidence_count, updated_at FROM user_interaction_profile'
    ).all() as unknown as ProfileRow[]
    const byDimension = new Map(existing.map((row) => [row.dimension, row]))
    const baseline = this.baselineOf()
    const entries: InteractionEntry[] = []
    for (const dimension of GROWTH_DIMENSIONS) {
      const row = byDimension.get(dimension)
      if (row) {
        // The stored offset is a projection over the signal ledger, and the
        // ledger can shrink: deleting a message removes its signals through a
        // trigger. A stale projection would keep adapting to a sentence the
        // user deleted, so a count mismatch rebuilds it before it is read.
        const ledgerCount = Number((this.database.connection.prepare(
          'SELECT COUNT(*) AS n FROM user_interaction_signals WHERE dimension = ?'
        ).get(dimension) as { n: number }).n)
        if (ledgerCount !== row.evidence_count) {
          entries.push(this.recompute(dimension))
          continue
        }
        entries.push({
          dimension,
          baseline: row.baseline,
          offset: row.offset,
          evidenceCount: row.evidence_count,
          updatedAt: row.updated_at
        })
        continue
      }
      // Seeded lazily: the identity baseline can be edited by the user, and a
      // row written at migration time would freeze the old value.
      const seeded: InteractionEntry = {
        dimension,
        baseline: baseline[dimension],
        offset: 0,
        evidenceCount: 0,
        updatedAt: this.clock()
      }
      this.database.connection.prepare(`
        INSERT INTO user_interaction_profile(dimension, baseline, offset, evidence_count, algorithm_version, updated_at)
        VALUES (?, ?, 0, 0, ?, ?)
        ON CONFLICT(dimension) DO NOTHING
      `).run(dimension, seeded.baseline, INTERACTION_ALGORITHM_VERSION, seeded.updatedAt)
      entries.push(seeded)
    }
    return entries
  }

  offsets(): Record<GrowthDimension, number> {
    const entries = this.list()
    return {
      warmth: entries.find((entry) => entry.dimension === 'warmth')?.offset ?? 0,
      directness: entries.find((entry) => entry.dimension === 'directness')?.offset ?? 0,
      humor: entries.find((entry) => entry.dimension === 'humor')?.offset ?? 0
    }
  }

  /**
   * Stores one explicit style request and recomputes that dimension.
   *
   * `(dimension, turn_id)` is the key: a replayed turn or a second `prepare`
   * cannot double-count the same sentence.
   */
  apply(input: InteractionSignalInput): void {
    this.database.connection.prepare(`
      INSERT INTO user_interaction_signals(dimension, turn_id, signal, weight, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(dimension, turn_id) DO NOTHING
    `).run(input.dimension, input.turnId.toLowerCase(), input.signal, input.weight, input.source.slice(0, 64), input.at)
    this.recompute(input.dimension)
  }

  /** Rebuilds one dimension from its signal ledger. */
  recompute(dimension: GrowthDimension): InteractionEntry {
    const rows = this.database.connection.prepare(
      'SELECT dimension, turn_id, signal, weight, created_at FROM user_interaction_signals WHERE dimension = ? ORDER BY created_at, turn_id'
    ).all(dimension) as unknown as GrowthSignalRow[]
    const folded = foldGrowth(rows, this.clock())
    const baseline = this.baselineOf()[dimension]
    const updatedAt = this.clock()
    this.database.connection.prepare(`
      INSERT INTO user_interaction_profile(dimension, baseline, offset, evidence_count, algorithm_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(dimension) DO UPDATE SET
        baseline = excluded.baseline,
        offset = excluded.offset,
        evidence_count = excluded.evidence_count,
        algorithm_version = excluded.algorithm_version,
        updated_at = excluded.updated_at
    `).run(dimension, baseline, folded.offset, folded.evidenceCount, INTERACTION_ALGORITHM_VERSION, updatedAt)
    return { dimension, baseline, offset: folded.offset, evidenceCount: folded.evidenceCount, updatedAt }
  }

  /**
   * Withdraws every adaptation for one dimension.
   *
   * The identity baseline is not touched, because it was never changed: this
   * only clears what the user's own requests moved.
   */
  rollback(dimension: GrowthDimension): void {
    this.database.connection.prepare('DELETE FROM user_interaction_signals WHERE dimension = ?').run(dimension)
    this.recompute(dimension)
  }

  /** Bounded prompt line; only dimensions with evidence are described. */
  describe(): string {
    const learned = this.list().filter((entry) => entry.evidenceCount > 0 && entry.offset !== 0)
    if (learned.length === 0) return ''
    const described = learned.map((entry) => `${entry.dimension} ${entry.offset > 0 ? '+' : ''}${entry.offset.toFixed(2)}`)
    return `Interaction style adapted to what this user asked for (${described.join('; ')}). This is presentation only: it does not change Morrow's identity, values or interests, and it never overrides facts or permissions.`
  }
}

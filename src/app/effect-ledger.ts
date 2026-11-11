import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'

/**
 * Durable record of every projected side effect.
 *
 * The outbox guarantees *at least once*: a row is committed before it runs, and
 * a crash between "the side effect happened" and "the row was marked done"
 * replays it. That is unavoidable without a distributed transaction, so the
 * honest design is to make every effect idempotent and to record, separately,
 * whether it was applied. This table is that record.
 *
 * Two states matter to callers:
 *
 *   - `applied` means the business write is committed. A replay must not run it
 *     again, and it must not be treated as "pending because the row is gone".
 *   - `terminal_failed` means the effect gave up. It is visible in `stats()`
 *     instead of being retried forever or, worse, reported as done.
 *
 * The identity is `(turn_id, module, handler_version, effect_key)`. `effect_key`
 * is derived by the projector from its own input — never a random id — so the
 * same logical effect lands on the same row across process restarts.
 */
export const EFFECT_STATES = ['pending', 'running', 'applied', 'failed_retryable', 'terminal_failed'] as const
export type EffectState = (typeof EFFECT_STATES)[number]

/** Attempts before an effect is parked as terminally failed. */
export const EFFECT_MAX_ATTEMPTS = 5

export interface EffectIdentity {
  /** The turn (or reflection run) the effect belongs to. */
  turnId: string
  module: string
  handlerVersion: number
  /** Stable within the turn: the effect's own identity, not a counter. */
  effectKey: string
}

export interface EffectRecord extends EffectIdentity {
  effectId: string
  state: EffectState
  attempts: number
  lastErrorCode: string | null
  appliedAt: string | null
  updatedAt: string
  /** Which worker holds the claim, null when nobody does. */
  claimOwner: string | null
  /** When the claim stops being exclusive; an expired lease is claimable again. */
  leaseUntil: string | null
}

/** How long one claim is exclusive before another worker may take it over. */
export const EFFECT_LEASE_MS = 60_000

/** A claim carries the generation that must be presented to complete or fail. */
export type ClaimResult =
  | { status: 'run'; generation: number }
  | { status: 'applied' }
  | { status: 'busy' }

interface EffectRow {
  effect_id: string
  turn_id: string
  module: string
  handler_version: number
  effect_key: string
  state: string
  attempts: number
  last_error_code: string | null
  applied_at: string | null
  updated_at: string
  claim_owner: string | null
  lease_until: string | null
}

function mapRow(row: EffectRow): EffectRecord {
  return {
    effectId: row.effect_id,
    turnId: row.turn_id,
    module: row.module,
    handlerVersion: row.handler_version,
    effectKey: row.effect_key,
    state: row.state as EffectState,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
    claimOwner: row.claim_owner ?? null,
    leaseUntil: row.lease_until ?? null
  }
}

export class CognitiveEffectLedger {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID(),
    /** Identifies this worker so a claim cannot be completed by another one. */
    private readonly workerId: string = makeId()
  ) {}

  /**
   * Claims an effect for this attempt.
   *
   * Returns `applied` when a previous attempt already committed the business
   * write — the caller must then skip the side effect entirely. Otherwise the
   * row is moved to `running` and the caller owns it until it calls
   * `complete` or `fail`.
   */
  begin(identity: EffectIdentity): ClaimResult {
    // One transaction, one conditional UPDATE, and a changed-row count. The
    // claim is conditional on (a) a claimable state and (b) the lease being
    // absent or expired. Every successful claim increments lease_generation;
    // complete/fail must present that generation, so a worker whose lease was
    // stolen can never overwrite the new owner's state.
    return this.database.transaction(() => {
      const at = this.clock()
      this.database.connection.prepare(`
        INSERT INTO cognitive_effect_ledger(effect_id, turn_id, module, handler_version, effect_key, state, attempts, last_error_code, applied_at, created_at, updated_at, claim_owner, lease_until, lease_generation)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, NULL, NULL, 0)
        ON CONFLICT(turn_id, module, handler_version, effect_key) DO NOTHING
      `).run(this.makeId().toLowerCase(), identity.turnId, identity.module, identity.handlerVersion, identity.effectKey, at, at)

      const lease = new Date(Date.parse(at) + EFFECT_LEASE_MS).toISOString()
      const claimed = this.database.connection.prepare(`
        UPDATE cognitive_effect_ledger
        SET state = 'running',
            claim_owner = ?,
            lease_until = ?,
            attempts = attempts + 1,
            lease_generation = lease_generation + 1,
            updated_at = ?
        WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?
          AND state IN ('pending', 'failed_retryable')
      `).run(this.workerId, lease, at, identity.turnId, identity.module, identity.handlerVersion, identity.effectKey)
      if (Number(claimed.changes) === 1) return { status: 'run' as const, generation: this.generationOf(identity) }

      const row = this.find(identity)
      if (!row) throw new Error('Effect ledger row disappeared immediately after insert.')
      if (row.state === 'applied') return { status: 'applied' as const }
      // A `running` row whose lease expired is abandoned work: take it over.
      if (row.state === 'running' && row.leaseUntil !== null && row.leaseUntil < at) {
        const stolen = this.database.connection.prepare(`
          UPDATE cognitive_effect_ledger
          SET claim_owner = ?, lease_until = ?, attempts = attempts + 1,
              lease_generation = lease_generation + 1, updated_at = ?
          WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?
            AND state = 'running' AND lease_until = ?
        `).run(this.workerId, lease, at, identity.turnId, identity.module, identity.handlerVersion, identity.effectKey, row.leaseUntil)
        if (Number(stolen.changes) === 1) return { status: 'run' as const, generation: this.generationOf(identity) }
      }
      return { status: 'busy' as const }
    })
  }

  private generationOf(identity: EffectIdentity): number {
    const row = this.database.connection.prepare(
      'SELECT lease_generation FROM cognitive_effect_ledger WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?'
    ).get(identity.turnId, identity.module, identity.handlerVersion, identity.effectKey) as { lease_generation: number }
    return Number(row.lease_generation)
  }

  /** Marks the effect applied. Only the claiming worker may do this. */
  /** Marks the effect applied. Only the claiming generation may do this. */
  complete(identity: EffectIdentity, generation: number): boolean {
    const at = this.clock()
    const result = this.database.connection.prepare(`
      UPDATE cognitive_effect_ledger
      SET state = 'applied', applied_at = ?, last_error_code = NULL, updated_at = ?,
          lease_until = NULL
      WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?
        AND claim_owner = ? AND lease_generation = ? AND state = 'running'
    `).run(at, at, identity.turnId, identity.module, identity.handlerVersion, identity.effectKey, this.workerId, generation)
    return Number(result.changes) === 1
  }

  /**
   * Records a failed attempt.
   *
   * A stable error *code* is stored, never the message: an error string can
   * contain a user's text, and this table is read by diagnostics. The update is
   * fenced by the generation: an old worker cannot fail the new owner's claim.
   */
  fail(identity: EffectIdentity, errorCode: string, generation: number): { state: EffectState; owned: boolean } {
    const at = this.clock()
    const row = this.find(identity)
    const attempts = row?.attempts ?? 1
    const state: EffectState = attempts >= EFFECT_MAX_ATTEMPTS ? 'terminal_failed' : 'failed_retryable'
    const result = this.database.connection.prepare(`
      UPDATE cognitive_effect_ledger
      SET state = ?, last_error_code = ?, updated_at = ?, lease_until = NULL
      WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?
        AND claim_owner = ? AND lease_generation = ? AND state = 'running'
    `).run(state, errorCode.slice(0, 64), at, identity.turnId, identity.module, identity.handlerVersion, identity.effectKey, this.workerId, generation)
    return { state, owned: Number(result.changes) === 1 }
  }

  find(identity: EffectIdentity): EffectRecord | null {
    const row = this.database.connection.prepare(`
      SELECT * FROM cognitive_effect_ledger
      WHERE turn_id = ? AND module = ? AND handler_version = ? AND effect_key = ?
    `).get(identity.turnId, identity.module, identity.handlerVersion, identity.effectKey) as EffectRow | undefined
    return row ? mapRow(row) : null
  }

  /** Every effect recorded for one turn, oldest first. Used by audits and tests. */
  forTurn(turnId: string): EffectRecord[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM cognitive_effect_ledger WHERE turn_id = ? ORDER BY created_at, module, effect_key'
    ).all(turnId) as unknown as EffectRow[]
    return rows.map(mapRow)
  }

  stats(): Record<EffectState, number> {
    const rows = this.database.connection.prepare(
      'SELECT state, COUNT(*) AS n FROM cognitive_effect_ledger GROUP BY state'
    ).all() as Array<{ state: string; n: number }>
    const byState = new Map(rows.map((row) => [row.state, Number(row.n)]))
    return {
      pending: byState.get('pending') ?? 0,
      running: byState.get('running') ?? 0,
      applied: byState.get('applied') ?? 0,
      failed_retryable: byState.get('failed_retryable') ?? 0,
      terminal_failed: byState.get('terminal_failed') ?? 0
    }
  }

  /**
   * Re-arms effects that were interrupted mid-flight.
   *
   * A `running` row means the process died between claim and completion. The
   * business write may or may not have committed, which is exactly why every
   * projector is idempotent: replaying it is safe, and not replaying it would
   * lose the effect. Called on startup.
   */
  requeueInterrupted(): number {
    const at = this.clock()
    const result = this.database.connection.prepare(`
      UPDATE cognitive_effect_ledger
      SET state = 'failed_retryable', updated_at = ?, lease_until = NULL,
          claim_owner = NULL, lease_generation = lease_generation + 1
      WHERE state = 'running' AND (lease_until IS NULL OR lease_until <= ?)
    `).run(at, at)
    return Number(result.changes)
  }
}

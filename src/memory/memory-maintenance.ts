/**
 * Long-running memory maintenance scheduler (D-12 remediation).
 *
 * Before this, consolidation/decay/archive ran exactly once at app start, so a
 * machine that stays up for weeks never re-scored its memories. The scheduler
 * replaces that startup block with a lifecycle-controlled loop:
 *
 *   - a catch-up pass at start (the old behaviour, now through one path);
 *   - a pass every `intervalMs` while the app runs, decided by *absolute*
 *     time differences against `memory_maintenance_state.last_run_at` — a
 *     host sleep or a crash can never double-apply a decay tick, because the
 *     passes recompute from the evidence ledger instead of incrementing;
 *   - a single-instance mutex: the state row is claimed inside the same
 *     immediate transaction that runs the jobs, so a hung pass cannot run
 *     concurrently with itself;
 *   - failures are recorded with `last_status='failed'` and retried on the
 *     next tick; nothing here can break the chat path.
 *
 * What it deliberately does not do: archive or delete anything the importance
 * rules protect (user pins, boundaries, explicit corrections — the protection
 * lives in `archiveBelow`, which this scheduler only calls).
 */
import type { SqliteDatabase } from '../persistence/database'
import type { MemoryImportanceService } from './memory-importance'

export const MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface MaintenanceOutcome {
  trigger: 'startup' | 'interval'
  groups: number
  archived: number
  rescored: number
  durationMs: number
  status: 'ok' | 'failed'
  reason?: string
}

export class MemoryMaintenanceScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastOutcome: MaintenanceOutcome | null = null

  constructor(private readonly options: {
    database: SqliteDatabase
    importance: MemoryImportanceService
    clock?: (() => string) | undefined
    intervalMs?: number | undefined
    archiveThreshold?: number | undefined
    archiveOlderThanDays?: number | undefined
    onPass?: ((outcome: MaintenanceOutcome) => void) | undefined
  }) {}

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  private get intervalMs(): number {
    return Math.max(60_000, this.options.intervalMs ?? MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS)
  }

  /**
   * Runs one pass if the absolute-time gate allows it, under the state-row
   * mutex. `force` bypasses the gate (startup catch-up and tests use it).
   */
  runOnce(trigger: 'startup' | 'interval', force = false): MaintenanceOutcome | null {
    if (this.running) return null
    const now = this.clock()
    const nowMs = Date.parse(now)
    const database = this.options.database
    database.connection.exec('BEGIN IMMEDIATE')
    try {
      const state = database.connection.prepare('SELECT last_run_at, last_status FROM memory_maintenance_state WHERE singleton = 1').get() as { last_run_at: string; last_status: string } | undefined
      if (state && !force) {
        const elapsed = nowMs - Date.parse(state.last_run_at)
        if (Number.isFinite(elapsed) && elapsed < this.intervalMs) {
          database.connection.exec('COMMIT')
          return null
        }
      }
      const startedMs = Date.now()
      let outcome: MaintenanceOutcome
      try {
        const rescored = this.options.importance.recomputeAll()
        const groups = this.options.importance.consolidate()
        const archived = this.options.importance.archiveBelow(this.options.archiveThreshold, this.options.archiveOlderThanDays ?? 180)
        outcome = { trigger, groups: groups.length, archived: archived.length, rescored, durationMs: Date.now() - startedMs, status: 'ok' }
      } catch (error) {
        outcome = { trigger, groups: 0, archived: 0, rescored: 0, durationMs: Date.now() - startedMs, status: 'failed', reason: error instanceof Error ? error.message : String(error) }
      }
      database.connection.prepare(`
        INSERT INTO memory_maintenance_state(singleton, last_run_at, last_status, last_duration_ms)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          last_run_at = excluded.last_run_at,
          last_status = excluded.last_status,
          last_duration_ms = excluded.last_duration_ms
      `).run(now, outcome.status, outcome.durationMs)
      database.connection.exec('COMMIT')
      this.lastOutcome = outcome
      this.options.onPass?.(outcome)
      return outcome
    } catch (error) {
      try {
        database.connection.exec('ROLLBACK')
      } catch {
        // The transaction may already be gone; the caller gets the original error.
      }
      throw error
    }
  }

  /** Catch-up pass now, then the interval loop. Idempotent to double starts. */
  start(): void {
    if (this.timer) return
    try {
      this.runOnce('startup', true)
    } catch {
      // The catch-up must never block app start; the interval pass retries.
    }
    this.timer = setInterval(() => {
      try {
        this.runOnce('interval')
      } catch {
        // Same contract: a scheduler failure never surfaces into the app.
      }
    }, this.intervalMs)
    // Do not keep the process alive for the timer alone.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Diagnostics for the shell: last pass outcome and next scheduled run. */
  status(): { lastOutcome: MaintenanceOutcome | null; intervalMs: number; running: boolean } {
    return { lastOutcome: this.lastOutcome, intervalMs: this.intervalMs, running: this.timer !== null }
  }
}

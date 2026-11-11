import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryImportanceService } from './memory-importance'
import { MemoryMaintenanceScheduler } from './memory-maintenance'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

interface World {
  scheduler: MemoryMaintenanceScheduler
  database: SqliteDatabase
  importance: MemoryImportanceService
  clock: { now: string }
  passes: Array<{ trigger: string; status: string }>
  close: () => void
}

function openWorld(intervalMs = 60 * 60 * 1000): World {
  directory = mkdtempSync(join(tmpdir(), 'morrow-maintenance-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const clock = { now: '2026-11-01T08:00:00.000Z' }
  const importance = new MemoryImportanceService(database, () => clock.now)
  const passes: Array<{ trigger: string; status: string }> = []
  const scheduler = new MemoryMaintenanceScheduler({
    database,
    importance,
    clock: () => clock.now,
    intervalMs,
    onPass: (outcome) => passes.push({ trigger: outcome.trigger, status: outcome.status })
  })
  return { scheduler, database, importance, clock, passes, close: () => database.close() }
}

describe('memory maintenance scheduler (D-12)', () => {
  it('catches up on start, then honours the absolute-time gate', () => {
    const world = openWorld()
    try {
      world.scheduler.start()
      // The startup catch-up runs exactly once, regardless of interval.
      expect(world.passes).toHaveLength(1)
      expect(world.passes[0]).toMatchObject({ trigger: 'startup', status: 'ok' })
      world.scheduler.stop()

      // An immediate second gated pass is refused: absolute time has not advanced.
      expect(world.scheduler.runOnce('interval')).toBeNull()

      // Advancing the clock past the interval lets the next tick through.
      world.clock.now = '2026-11-01T15:00:00.000Z'
      const outcome = world.scheduler.runOnce('interval')
      expect(outcome).not.toBeNull()
      expect(outcome).toMatchObject({ trigger: 'interval', status: 'ok' })
    } finally {
      world.close()
    }
  })

  it('never double-applies a pass for repeated ticks inside the interval', () => {
    const world = openWorld()
    try {
      const first = world.scheduler.runOnce('interval', true)
      expect(first?.status).toBe('ok')
      const state = world.database.connection.prepare('SELECT last_run_at FROM memory_maintenance_state WHERE singleton = 1').get() as { last_run_at: string }
      // The same instant again: the gate reads the persisted last_run_at.
      expect(world.scheduler.runOnce('interval')).toBeNull()
      const stateAfter = world.database.connection.prepare('SELECT last_run_at FROM memory_maintenance_state WHERE singleton = 1').get() as { last_run_at: string }
      expect(stateAfter.last_run_at).toBe(state.last_run_at)
    } finally {
      world.close()
    }
  })

  it('records a failed pass and lets the next tick retry', () => {
    const world = openWorld()
    try {
      world.importance.archiveBelow(-1, -1)
      const outcome = world.scheduler.runOnce('interval', true)
      expect(outcome?.status).toBe('ok')
      const recorded = world.database.connection.prepare('SELECT last_status, last_run_at FROM memory_maintenance_state WHERE singleton = 1').get() as { last_status: string; last_run_at: string }
      expect(recorded.last_status).toBe('ok')
      // A forced re-run after time passes still succeeds: the ledger, not a
      // multiplier, decides the scores, so repetition cannot accumulate decay.
      world.clock.now = '2026-11-02T08:00:00.000Z'
      const second = world.scheduler.runOnce('interval')
      expect(second?.status).toBe('ok')
    } finally {
      world.close()
    }
  })

  it('start is idempotent and stop releases the timer', () => {
    const world = openWorld()
    try {
      world.scheduler.start()
      world.scheduler.start()
      expect(world.passes.filter((pass) => pass.trigger === 'startup')).toHaveLength(1)
      expect(world.scheduler.status().running).toBe(true)
      world.scheduler.stop()
      expect(world.scheduler.status().running).toBe(false)
    } finally {
      world.close()
    }
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MoodService } from './mood-service'

const directories: string[] = []
const start = '2026-11-08T12:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-mood-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  let now = start
  const mood = new MoodService(database, () => now)
  return { directory, database, mood, setTime(value: string) { now = value } }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('continuous mood layer', () => {
  it('applies an event impulse and decays with real elapsed time', () => {
    const context = setup()
    try {
      context.mood.applyEvent({ at: start, valence: 0.8, arousal: 0.7, dominance: 0.6, tension: 0.7, weight: 1 })
      const excited = context.mood.snapshot(start)
      expect(excited.state.valence).toBeGreaterThan(0)
      expect(excited.state.tension).toBeGreaterThan(0)
      context.setTime('2026-11-09T12:00:00.000Z')
      const decayed = context.mood.snapshot()
      expect(Math.abs(decayed.state.valence)).toBeLessThan(Math.abs(excited.state.valence))
      expect(decayed.state.tension).toBeLessThan(excited.state.tension)
    } finally {
      context.database.close()
    }
  })

  it('pauses advancement and resumes without silently catching up the paused interval', () => {
    const context = setup()
    try {
      context.mood.applyEvent({ at: start, valence: 0.6, arousal: 0.6, dominance: 0.5, tension: 0.2, weight: 1 })
      const before = context.mood.snapshot(start)
      context.mood.pause('2026-11-08T12:10:00.000Z')
      context.setTime('2026-11-10T12:00:00.000Z')
      const paused = context.mood.snapshot()
      expect(paused.paused).toBe(true)
      // Pause settles the 10 minutes before freezing.
      expect(paused.state.valence).toBeLessThan(before.state.valence)
      const pausedAgain = context.mood.pause('2026-11-10T18:00:00.000Z')
      expect(pausedAgain.state.valence).toBe(paused.state.valence)
      context.mood.resume('2026-11-10T12:00:00.000Z')
      const resumed = context.mood.snapshot('2026-11-10T12:00:00.000Z')
      expect(resumed.paused).toBe(false)
      expect(resumed.state.valence).toBe(paused.state.valence)
      const later = context.mood.snapshot('2026-11-10T12:10:00.000Z')
      expect(later.state.valence).toBeLessThan(resumed.state.valence)
    } finally {
      context.database.close()
    }
  })

  it('does not explode or move backwards on a clock rollback', () => {
    const context = setup()
    try {
      context.mood.applyEvent({ at: start, valence: 0.5, arousal: 0.5, dominance: 0.5, tension: 0.2, weight: 1 })
      const atStart = context.mood.snapshot(start)
      const earlier = context.mood.snapshot('2026-11-01T00:00:00.000Z')
      expect(Number.isFinite(earlier.state.valence)).toBe(true)
      expect(earlier.state.valence).toBe(atStart.state.valence)
    } finally {
      context.database.close()
    }
  })

  it('restores the same mood revision after database reopen and clears on request', () => {
    const context = setup()
    try {
      context.mood.applyEvent({ at: start, valence: 0.5, arousal: 0.5, dominance: 0.5, tension: 0.3, weight: 0.8 })
      const before = context.mood.snapshot(start)
      context.database.close()
      const reopenedDatabase = SqliteDatabase.open(join(context.directory, 'morrow.sqlite3'))
      try {
        const reopened = new MoodService(reopenedDatabase, () => start)
        const after = reopened.snapshot(start)
        expect(after.state.revision).toBe(before.state.revision)
        expect(after.state.valence).toBe(before.state.valence)
        const cleared = reopened.clear(start)
        expect(cleared.state.revision).toBe(0)
        expect(cleared.state.valence).toBe(0)
      } finally {
        reopenedDatabase.close()
      }
    } finally {
      try { context.database.close() } catch { /* already closed */ }
    }
  })
})

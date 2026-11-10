import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MoodService } from './mood-service'

const directories: string[] = []
const start = '2026-11-12T12:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-mood-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  let now = start
  const mood = new MoodService(database, () => now)
  mood.clear(start)
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
      context.setTime('2026-11-13T12:00:00.000Z')
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
      context.mood.pause('2026-11-12T12:10:00.000Z')
      context.setTime('2026-11-12T12:00:00.000Z')
      const paused = context.mood.snapshot()
      expect(paused.paused).toBe(true)
      // Pause settles the 10 minutes before freezing.
      expect(paused.state.valence).toBeLessThan(before.state.valence)
      const pausedAgain = context.mood.pause('2026-11-12T12:30:00.000Z')
      expect(pausedAgain.state.valence).toBe(paused.state.valence)
      const suppressed = context.mood.applyEvent({ at: '2026-11-12T12:40:00.000Z', valence: 1, arousal: 1, dominance: 1, tension: 1, weight: 1 })
      expect(suppressed.state.valence).toBe(paused.state.valence)
      expect(suppressed.state.revision).toBe(paused.state.revision)
      context.mood.resume('2026-11-12T12:45:00.000Z')
      const resumed = context.mood.snapshot('2026-11-12T12:45:00.000Z')
      expect(resumed.paused).toBe(false)
      expect(resumed.state.valence).toBe(paused.state.valence)
      const later = context.mood.snapshot('2026-11-12T12:55:00.000Z')
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
      const persisted = context.database.connection.prepare('SELECT state_json, last_advanced_at FROM morrow_mood_state WHERE id = 1').get() as { state_json: string; last_advanced_at: string }
      const state = JSON.parse(persisted.state_json) as { evaluatedAt: string }
      expect(Date.parse(state.evaluatedAt)).toBeGreaterThanOrEqual(Date.parse(start))
      expect(Date.parse(persisted.last_advanced_at)).toBeGreaterThanOrEqual(Date.parse(start))
    } finally {
      context.database.close()
    }
  })

  it('rebuilds mood from the remaining source after one conversation is deleted', () => {
    const context = setup()
    try {
      const conversationA = '11111111-1111-4111-8111-111111111111'
      const conversationB = '22222222-2222-4222-8222-222222222222'
      context.mood.applyEvent({
        at: start, valence: 0.9, arousal: 0.8, dominance: 0.6, tension: 0.7, weight: 1,
        sourceEventId: '11111111-1111-4111-8111-111111111111', sourceConversationId: conversationA
      })
      context.mood.applyEvent({
        at: '2026-11-12T12:10:00.000Z', valence: -0.6, arousal: 0.4, dominance: 0.5, tension: 0.5, weight: 1,
        sourceEventId: '33333333-3333-4333-8333-333333333333', sourceConversationId: conversationB
      })
      const both = context.mood.snapshot('2026-11-12T12:10:00.000Z')
      expect(both.state.revision).toBe(2)
      expect(context.mood.deleteConversation(conversationA, '2026-11-12T12:10:00.000Z')).toBe(1)
      const rebuilt = context.mood.snapshot('2026-11-12T12:10:00.000Z')
      // A's positive impulse is gone; only B's negative turn remains.
      expect(rebuilt.state.revision).toBe(1)
      expect(rebuilt.state.valence).toBeLessThan(0)
      const rows = context.database.connection.prepare(
        'SELECT source_conversation_id FROM morrow_mood_contributions WHERE kind = ? ORDER BY seq'
      ).all('impulse') as Array<{ source_conversation_id: string }>
      expect(rows.map((row) => row.source_conversation_id)).toEqual([conversationB])
    } finally {
      context.database.close()
    }
  })

  it('does not double-count a replayed source event', () => {
    const context = setup()
    try {
      const input = {
        at: start, valence: 0.6, arousal: 0.5, dominance: 0.5, tension: 0.2, weight: 1,
        sourceEventId: '44444444-4444-4444-8444-444444444444',
        sourceConversationId: '55555555-5555-4555-8555-555555555555'
      }
      const first = context.mood.applyEvent(input)
      const second = context.mood.applyEvent({ ...input, at: '2026-11-12T12:05:00.000Z' })
      expect(second.state.revision).toBe(first.state.revision)
      const count = context.database.connection.prepare(
        "SELECT COUNT(*) AS count FROM morrow_mood_contributions WHERE kind = 'impulse'"
      ).get() as { count: number }
      expect(count.count).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('keeps pause and resume markers faithful when a source is removed', () => {
    const context = setup()
    try {
      const conversation = '66666666-6666-4666-8666-666666666666'
      context.mood.applyEvent({
        at: start, valence: 0.5, arousal: 0.5, dominance: 0.5, tension: 0.2, weight: 1,
        sourceEventId: '77777777-7777-4777-8777-777777777777', sourceConversationId: conversation
      })
      context.mood.pause('2026-11-12T12:05:00.000Z')
      context.mood.resume('2026-11-12T12:20:00.000Z')
      context.mood.applyEvent({
        at: '2026-11-12T12:20:00.000Z', valence: -0.4, arousal: 0.3, dominance: 0.5, tension: 0.4, weight: 1,
        sourceEventId: '88888888-8888-4888-8888-888888888888', sourceConversationId: '99999999-9999-4999-8999-999999999999'
      })
      const before = context.mood.snapshot('2026-11-12T12:25:00.000Z')
      context.mood.deleteConversation(conversation, '2026-11-12T12:25:00.000Z')
      const after = context.mood.snapshot('2026-11-12T12:25:00.000Z')
      expect(after.state.revision).toBe(1)
      expect(after.paused).toBe(false)
      expect(after.state.valence).toBeLessThan(0)
      expect(after.state.valence).toBeLessThan(before.state.valence)
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

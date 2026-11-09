/**
 * Continuous mood layer (Issue #74 round 2).
 *
 * Event emotions are stored in `emotion_events`; traits are slow evidence-gated
 * revisions. Mood is the middle timescale: a bounded four-axis state that
 * advances with real elapsed time even while the app is closed (unless paused).
 * It uses deterministic mean reversion, not a probability model.
 */
import type { SqliteDatabase } from '../persistence/database'
import { ApplicationError } from '../shared/errors'

export const MOOD_ALGORITHM_VERSION = 'mood-ou-v1'

export interface MoodBase {
  valence: number
  arousal: number
  dominance: number
  tension: number
}

export interface MoodState extends MoodBase {
  revision: number
  evaluatedAt: string
  algorithmVersion: typeof MOOD_ALGORITHM_VERSION
}

export interface MoodView {
  available: boolean
  paused: boolean
  lastAdvancedAt: string
  state: MoodState
}

const BASELINE: MoodBase = { valence: 0, arousal: 0.35, dominance: 0.5, tension: 0 }
const HALF_LIFE_HOURS = { valence: 6, arousal: 1, dominance: 24, tension: 24 } as const

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function round(value: number): number {
  const result = Math.round(value * 10_000) / 10_000
  return Object.is(result, -0) ? 0 : result
}

function iso(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new ApplicationError('STORAGE_ERROR')
  return new Date(parsed).toISOString()
}

function clampMood(state: MoodState): MoodState {
  return {
    ...state,
    valence: round(clamp(state.valence, -1, 1)),
    arousal: round(clamp(state.arousal, 0, 1)),
    dominance: round(clamp(state.dominance, 0, 1)),
    tension: round(clamp(state.tension, 0, 1))
  }
}

export function advanceMood(state: MoodState, at: string): MoodState {
  const atMs = Math.max(Date.parse(state.evaluatedAt), Date.parse(at))
  const hours = Math.max(0, (atMs - Date.parse(state.evaluatedAt)) / 3_600_000)
  const next: MoodState = { ...state, evaluatedAt: new Date(atMs).toISOString() }
  for (const key of ['valence', 'arousal', 'dominance', 'tension'] as const) {
    const factor = Math.pow(2, -hours / HALF_LIFE_HOURS[key])
    next[key] = round((BASELINE[key] ?? 0) + (state[key] - (BASELINE[key] ?? 0)) * factor)
  }
  return clampMood(next)
}

export function describeMood(view: MoodView): string {
  if (!view.available) return ''
  const v = view.state.valence
  const tone = v > 0.15 ? 'positive' : v < -0.15 ? 'negative' : 'neutral'
  const energy = view.state.arousal > 0.6 ? 'high' : view.state.arousal < 0.25 ? 'low' : 'moderate'
  const control = view.state.dominance > 0.6 ? 'steady' : 'limited'
  return `Morrow's continuous mood (deterministic, elapsed-time model; not a claim of subjective feeling): tone=${tone}, energy=${energy}, control=${control}${view.paused ? ', paused' : ''}. Use only as a bounded expression/attention signal; never as a fact or permission.`
}

interface MoodRow {
  state_json: string
  revision: number
  paused: number
  last_advanced_at: string
  updated_at: string
}

function defaultState(at: string): MoodState {
  return { ...BASELINE, revision: 0, evaluatedAt: at, algorithmVersion: MOOD_ALGORITHM_VERSION }
}

function parseState(row: MoodRow): MoodState {
  let value: unknown
  try { value = JSON.parse(row.state_json) } catch { throw new ApplicationError('STORAGE_ERROR') }
  if (!value || typeof value !== 'object') throw new ApplicationError('STORAGE_ERROR')
  const state = value as MoodState
  if (!Number.isFinite(state.valence) || !Number.isFinite(state.arousal) || !Number.isFinite(state.dominance) ||
    !Number.isFinite(state.tension) || !Number.isInteger(state.revision) || typeof state.evaluatedAt !== 'string') {
    throw new ApplicationError('STORAGE_ERROR')
  }
  return clampMood({ ...state, algorithmVersion: MOOD_ALGORITHM_VERSION })
}

export class MoodService {
  constructor(private readonly database: SqliteDatabase, private readonly clock: () => string = () => new Date().toISOString()) {}

  get available(): boolean {
    return this.database.schemaVersion >= 56 && this.database.cognitivePersistenceAvailable
  }

  snapshot(at = this.clock()): MoodView {
    const evaluatedAt = iso(at)
    if (!this.available) {
      return { available: false, paused: false, lastAdvancedAt: evaluatedAt, state: defaultState(evaluatedAt) }
    }
    try {
      const row = this.row()
      const state = parseState(row)
      return {
        available: true,
        paused: row.paused === 1,
        lastAdvancedAt: row.last_advanced_at,
        state: row.paused === 1 ? state : advanceMood(state, evaluatedAt)
      }
    } catch {
      return { available: false, paused: false, lastAdvancedAt: evaluatedAt, state: defaultState(evaluatedAt) }
    }
  }

  applyEvent(input: { at?: string; valence: number; arousal: number; dominance: number; tension: number; weight: number }): MoodView {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    const at = iso(input.at ?? this.clock())
    const weight = clamp(input.weight, 0, 1)
    return this.database.transaction(() => {
      const row = this.row()
      const current = parseState(row)
      if (row.paused === 1) {
        // Automatic affect events are suppressed while paused; the frozen state
        // is returned unchanged and no revision is written.
        return { available: true, paused: true, lastAdvancedAt: row.last_advanced_at, state: current }
      }
      const effectiveAt = new Date(Math.max(Date.parse(current.evaluatedAt), Date.parse(at))).toISOString()
      const base = advanceMood(current, effectiveAt)
      const next = clampMood({
        ...base,
        valence: base.valence + input.valence * weight * 0.25,
        arousal: base.arousal + input.arousal * weight * 0.2,
        dominance: base.dominance + input.dominance * weight * 0.15,
        tension: base.tension + input.tension * weight * 0.2,
        revision: base.revision + 1,
        evaluatedAt: effectiveAt
      })
      this.write(next, false, effectiveAt, effectiveAt)
      return { available: true, paused: false, lastAdvancedAt: effectiveAt, state: next }
    })
  }

  pause(at = this.clock()): MoodView {
    return this.setPaused(true, at)
  }

  resume(at = this.clock()): MoodView {
    // Default: do not silently catch up paused elapsed time. The user sees the
    // same mood until the next event; the pause interval is recorded.
    return this.setPaused(false, at)
  }

  clear(at = this.clock()): MoodView {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    const now = iso(at)
    return this.database.transaction(() => {
      const state = defaultState(now)
      this.write(state, false, now, now)
      return { available: true, paused: false, lastAdvancedAt: now, state }
    })
  }

  private setPaused(paused: boolean, at: string): MoodView {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    const now = iso(at)
    return this.database.transaction(() => {
      const row = this.row()
      const current = parseState(row)
      // Pause first settles elapsed time up to `now`; resume keeps the frozen
      // value and deliberately does not replay the paused interval. Persisted
      // logical time is monotonic even if the wall clock moved backwards.
      const effectiveAt = new Date(Math.max(Date.parse(current.evaluatedAt), Date.parse(now))).toISOString()
      const advanced = row.paused === 1 ? current : advanceMood(current, effectiveAt)
      const state: MoodState = { ...advanced, evaluatedAt: effectiveAt }
      this.write(state, paused, effectiveAt, effectiveAt)
      return { available: true, paused, lastAdvancedAt: effectiveAt, state }
    })
  }

  private row(): MoodRow {
    const row = this.database.connection.prepare('SELECT * FROM morrow_mood_state WHERE id = 1').get() as unknown as MoodRow | undefined
    if (!row) throw new ApplicationError('STORAGE_ERROR')
    return row
  }

  private write(state: MoodState, paused: boolean, lastAdvancedAt: string, updatedAt: string): void {
    const result = this.database.connection.prepare(
      'UPDATE morrow_mood_state SET state_json = ?, revision = ?, paused = ?, last_advanced_at = ?, updated_at = ? WHERE id = 1'
    ).run(JSON.stringify(state), state.revision, paused ? 1 : 0, lastAdvancedAt, updatedAt)
    if (result.changes !== 1) throw new ApplicationError('STORAGE_ERROR')
  }
}

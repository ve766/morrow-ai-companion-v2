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

interface ContributionRow {
  seq: number
  kind: 'impulse' | 'pause' | 'resume' | 'checkpoint'
  source_event_id: string
  source_conversation_id: string | null
  applied_at: string
  payload_json: string
}

interface ContributionPayload {
  state?: MoodState
  paused?: number
  delta?: MoodBase
}

export class MoodService {
  constructor(private readonly database: SqliteDatabase, private readonly clock: () => string = () => new Date().toISOString()) {}

  get available(): boolean {
    return this.database.schemaVersion >= 56 && this.database.cognitivePersistenceAvailable
  }

  private get ledgerAvailable(): boolean {
    return this.database.schemaVersion >= 58 && this.database.cognitivePersistenceAvailable
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

  applyEvent(input: {
    at?: string
    valence: number
    arousal: number
    dominance: number
    tension: number
    weight: number
    sourceEventId?: string
    sourceConversationId?: string
  }): MoodView {
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
      // A replayed turn must not double-count its impulse. The ledger key is the
      // emotion event id, which is deterministic per turn.
      if (this.ledgerAvailable && input.sourceEventId && this.contributionExists(input.sourceEventId)) {
        return this.snapshot(at)
      }
      const effectiveAt = new Date(Math.max(Date.parse(current.evaluatedAt), Date.parse(at))).toISOString()
      const base = advanceMood(current, effectiveAt)
      const delta: MoodBase = {
        valence: input.valence * weight * 0.25,
        arousal: input.arousal * weight * 0.2,
        dominance: input.dominance * weight * 0.15,
        tension: input.tension * weight * 0.2
      }
      const next = clampMood({
        ...base,
        valence: base.valence + delta.valence,
        arousal: base.arousal + delta.arousal,
        dominance: base.dominance + delta.dominance,
        tension: base.tension + delta.tension,
        revision: base.revision + 1,
        evaluatedAt: effectiveAt
      })
      if (this.ledgerAvailable) {
        this.insertContribution({
          kind: 'impulse',
          sourceEventId: input.sourceEventId ?? `auto:${effectiveAt}:${next.revision}`,
          conversationId: input.sourceConversationId ?? null,
          appliedAt: effectiveAt,
          payload: { delta }
        })
      }
      this.write(next, false, effectiveAt, effectiveAt)
      return { available: true, paused: false, lastAdvancedAt: effectiveAt, state: next }
    })
  }

  /**
   * Rebuild mood from the surviving source contributions. Deleting one
   * conversation removes exactly its impulses; pause/resume/checkpoint markers
   * keep the replay faithful to the logical timeline.
   */
  deleteConversation(conversationId: string, at = this.clock()): number {
    if (!this.available || !this.ledgerAvailable) return 0
    const now = iso(at)
    return this.database.transaction(() => {
      const removed = Number(this.database.connection.prepare(
        'DELETE FROM morrow_mood_contributions WHERE source_conversation_id = ?'
      ).run(conversationId).changes)
      if (removed > 0) this.rebuild(now)
      return removed
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
      if (this.ledgerAvailable) {
        this.database.connection.prepare('DELETE FROM morrow_mood_contributions').run()
        this.insertContribution({
          kind: 'checkpoint',
          sourceEventId: `clear:${now}`,
          conversationId: null,
          appliedAt: now,
          payload: { state, paused: 0 }
        })
      }
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
      if (this.ledgerAvailable) {
        this.insertContribution({
          kind: paused ? 'pause' : 'resume',
          sourceEventId: `${paused ? 'pause' : 'resume'}:${effectiveAt}`,
          conversationId: null,
          appliedAt: effectiveAt,
          payload: {}
        })
      }
      this.write(state, paused, effectiveAt, effectiveAt)
      return { available: true, paused, lastAdvancedAt: effectiveAt, state }
    })
  }

  private contributionExists(sourceEventId: string): boolean {
    return Boolean(this.database.connection.prepare(
      'SELECT 1 AS present FROM morrow_mood_contributions WHERE source_event_id = ?'
    ).get(sourceEventId))
  }

  private insertContribution(input: {
    kind: ContributionRow['kind']
    sourceEventId: string
    conversationId: string | null
    appliedAt: string
    payload: ContributionPayload
  }): void {
    this.database.connection.prepare(`
      INSERT OR IGNORE INTO morrow_mood_contributions(
        kind, source_event_id, source_conversation_id, applied_at, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.kind, input.sourceEventId, input.conversationId, input.appliedAt, JSON.stringify(input.payload), this.clock())
  }

  private rebuild(now: string): void {
    const rows = this.database.connection.prepare(
      'SELECT * FROM morrow_mood_contributions ORDER BY seq ASC'
    ).all() as unknown as ContributionRow[]
    if (rows.length === 0) return
    let start = -1
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]!.kind === 'checkpoint') {
        start = index
        break
      }
    }
    let state: MoodState
    let paused: boolean
    let from: number
    if (start >= 0) {
      const checkpoint = rows[start]!
      const parsed = this.payload(checkpoint)
      state = parsed.state
        ? clampMood({ ...parsed.state, algorithmVersion: MOOD_ALGORITHM_VERSION, evaluatedAt: checkpoint.applied_at })
        : defaultState(checkpoint.applied_at)
      paused = parsed.paused === 1
      from = start + 1
    } else {
      state = defaultState(rows[0]!.applied_at)
      paused = false
      from = 0
    }
    for (const row of rows.slice(from)) {
      const payload = this.payload(row)
      if (row.kind === 'checkpoint') {
        state = payload.state ? clampMood({ ...payload.state, algorithmVersion: MOOD_ALGORITHM_VERSION, evaluatedAt: row.applied_at }) : defaultState(row.applied_at)
        paused = payload.paused === 1
        continue
      }
      if (row.kind === 'pause') {
        if (!paused) state = advanceMood(state, row.applied_at)
        paused = true
        state = { ...state, evaluatedAt: row.applied_at }
        continue
      }
      if (row.kind === 'resume') {
        paused = false
        state = { ...state, evaluatedAt: row.applied_at }
        continue
      }
      if (paused || !payload.delta) continue
      const base = advanceMood(state, row.applied_at)
      state = clampMood({
        ...base,
        valence: base.valence + payload.delta.valence,
        arousal: base.arousal + payload.delta.arousal,
        dominance: base.dominance + payload.delta.dominance,
        tension: base.tension + payload.delta.tension,
        revision: base.revision + 1,
        evaluatedAt: row.applied_at
      })
    }
    if (!paused) state = advanceMood(state, now)
    const lastAdvancedAt = paused ? state.evaluatedAt : now
    this.write(state, paused, lastAdvancedAt, now)
  }

  private payload(row: ContributionRow): ContributionPayload {
    try {
      const parsed = JSON.parse(row.payload_json) as ContributionPayload
      if (!parsed || typeof parsed !== 'object') return {}
      return parsed
    } catch {
      return {}
    }
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

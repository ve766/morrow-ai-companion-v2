/**
 * Bounded personality growth (Stage 3, algorithm G1).
 *
 * The stable personality the user edits stays the baseline. Growth never writes
 * it: it accumulates a *signed offset* per dimension and the effective profile is
 * `clip(baseline + offset, 0, 100)`. Four rules make that offset trustworthy:
 *
 *   1. **Evidence is the source of truth.** `personality_growth_signals` holds one
 *      row per (dimension, turn). The offset is always a fold over those rows and
 *      is never incremented on its own, so replaying a turn converges and
 *      deleting a message removes its influence on the next read.
 *   2. **No movement without repetition.** Fewer than `GROWTH_MIN_EVIDENCE`
 *      independent turns cannot move a dimension at all. A single intense turn is
 *      recorded as evidence and reported as withheld, not applied.
 *   3. **The step is capped twice.** One accepted signal moves a dimension by at
 *      most `GROWTH_STEP` points, and the folded offset is clamped to
 *      ±`GROWTH_MAX_OFFSET`. Personality cannot be rewritten by accumulation.
 *   4. **Old evidence fades.** Each signal is discounted by a 45-day half-life,
 *      so a preference the user stopped expressing stops steering the profile.
 *      The rows are kept — only their weight decays — so the history stays
 *      auditable.
 *
 * This is a rule-derived engineering heuristic, not a psychological measurement,
 * and the prompt block that consumes it says so.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import { stripQuotedAndReportedText, type CognitiveTurnAnalysis } from '../cognition/cognition'
import type { PersonalizationEntry } from './personalization-service'

export const GROWTH_DIMENSIONS = ['warmth', 'directness', 'humor'] as const
export type GrowthDimension = typeof GROWTH_DIMENSIONS[number]

/** Hard cap on the drift, in points on the 0–100 personality scale. */
export const GROWTH_MAX_OFFSET = 8
/** Most one accepted signal may move a dimension, in points. */
export const GROWTH_STEP = 1
/** Independent turns required before any movement is allowed. */
export const GROWTH_MIN_EVIDENCE = 3
/** Evidence half-life in days. */
export const GROWTH_HALF_LIFE_DAYS = 45
/** Evidence older than this many half-lives is ignored by the fold. */
export const GROWTH_MAX_AGE_HALVES = 4

export interface GrowthSignalInput {
  dimension: GrowthDimension
  /** Signed direction, clamped to [-1, 1]. */
  signal: number
  /** Evidence reliability, clamped to [0, 1]. */
  weight: number
  turnId: string
  at: string
  /** The rule that produced this evidence; stored so a movement is explainable. */
  source?: string
}

export interface GrowthEntry {
  dimension: GrowthDimension
  /** Signed drift applied on top of the baseline, in points. */
  offset: number
  evidenceCount: number
  /** False while the evidence count is below the gate: recorded, not applied. */
  applied: boolean
  revision: number
  updatedAt: string
  lastTurnId: string | null
}

export interface GrowthSignalRow {
  dimension: string
  turn_id: string
  signal: number
  weight: number
  created_at: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function round(value: number): number {
  const rounded = Number(value.toFixed(4))
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Exponential discount for one signal, `0.5 ** (ageDays / halfLife)`. */
export function growthDecay(ageDays: number, halfLife = GROWTH_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1
  if (!Number.isFinite(halfLife) || halfLife <= 0) return 0
  return 0.5 ** (ageDays / halfLife)
}

/**
 * Folds signals into one offset.
 *
 * The fold is deliberately *not* an incremental update: it re-derives the offset
 * from every row, so a deleted message, a rolled-back dimension and a replayed
 * turn all land on the same value. Below the evidence gate the offset is 0 —
 * evidence is stored and visible, but it does not move the profile yet.
 */
export function foldGrowth(
  rows: readonly GrowthSignalRow[],
  now: string,
  options: { minEvidence?: number; maxOffset?: number; step?: number } = {}
): { offset: number; evidenceCount: number; applied: boolean } {
  const minEvidence = options.minEvidence ?? GROWTH_MIN_EVIDENCE
  const maxOffset = options.maxOffset ?? GROWTH_MAX_OFFSET
  const step = options.step ?? GROWTH_STEP
  const nowMs = Date.parse(now)
  let total = 0
  let counted = 0
  for (const row of rows) {
    const at = Date.parse(row.created_at)
    if (!Number.isFinite(at)) continue
    const ageDays = Math.max(0, (nowMs - at) / 86_400_000)
    if (ageDays > GROWTH_HALF_LIFE_DAYS * GROWTH_MAX_AGE_HALVES) continue
    counted += 1
    const decay = growthDecay(ageDays)
    // A single signal can contribute at most one step, in either direction.
    total += clamp(row.signal, -1, 1) * clamp(row.weight, 0, 1) * step * decay
  }
  const applied = counted >= minEvidence
  return {
    offset: applied ? round(clamp(total, -maxOffset, maxOffset)) : 0,
    evidenceCount: counted,
    applied
  }
}

/**
 * One explicit style directive, as a rule.
 *
 * Only *explicit* statements about how the user wants Morrow to sound count.
 * Corrections, memory requests and exploration permissions are deliberately not
 * used: they describe the content or the workflow of a turn, not a stable style,
 * and treating them as personality evidence was the bias this table replaces.
 */
interface StyleRule {
  dimension: GrowthDimension
  /** Strength of this directive, 0..1. */
  strength: number
  /** +1 when the directive asks for more of the trait, −1 when for less. */
  polarity: 1 | -1
  pattern: RegExp
  source: string
}

const STYLE_RULES: readonly StyleRule[] = Object.freeze([
  { dimension: 'directness', strength: 0.8, polarity: 1, source: 'explicit_direct_request', pattern: /(?:直接(?:一点|说|点)|别绕|直白|说重点|别铺垫|开门见山|\bget to the point\b|\bjust tell me\b)/iu },
  { dimension: 'directness', strength: 0.8, polarity: -1, source: 'explicit_soft_request', pattern: /(?:委婉|别这么直接|别太冲|温和一点|说软一点|别那么生硬|\bsofter\b|\bmore tactful\b)/iu },
  { dimension: 'warmth', strength: 0.7, polarity: 1, source: 'explicit_warmth_request', pattern: /(?:温柔|多关心我|暖一点|多陪陪我|抱抱|体贴一点|\bbe warmer\b)/iu },
  { dimension: 'warmth', strength: 0.7, polarity: -1, source: 'explicit_warmth_reduction', pattern: /(?:别煽情|别肉麻|别腻|冷一点|别关心我|保持距离|\bdon't be so affectionate\b)/iu },
  { dimension: 'humor', strength: 0.7, polarity: 1, source: 'explicit_humor_request', pattern: /(?:幽默|开个玩笑|轻松点|逗我|别太严肃|\bmake me laugh\b|\bbe playful\b)/iu },
  { dimension: 'humor', strength: 0.7, polarity: -1, source: 'explicit_humor_reduction', pattern: /(?:严肃(?:一)?点|别(?:老)?开玩笑|别说笑|正经(?:一)?点|别贫|\bbe serious\b)/iu }
])

/**
 * Turns in which a style phrase is *talked about* rather than *asked for*.
 * They must abstain: a hypothesis, a role-play instruction or a rhetorical
 * question is not a preference.
 */
const NON_ASSERTIVE = /(?:如果|假如|要是|假设|倘若|万一|扮演|假装|角色扮演|开个玩笑说|打个比方|比如说|反问|\bif you were\b|\bimagine\b|\bpretend\b|\bhypothetical\b)/iu

/** Below this the analyser is not sure enough for a stable-trait claim. */
export const GROWTH_MIN_CONFIDENCE = 50

export interface DerivedGrowthSignal {
  dimension: GrowthDimension
  /** Net evidence, −1..1: positive asks for more, negative for less. */
  signal: number
  /** Evidence reliability, 0..1 (the analyser's own confidence). */
  weight: number
  /** Which rules contributed, joined with `+`. */
  source: string
}

/**
 * Derives at most one *net* signal per dimension from one user turn.
 *
 * Two corrections to the first version:
 *
 *   - **Opposite evidence in the same turn is aggregated, not dropped.** A
 *     sentence that says "直接说，但别太冲" matches both directness rules; the
 *     first-match/`seen` design kept only the positive one. The net is now
 *     `Σ polarity·strength`, so the turn lands close to neutral instead of
 *     inventing a preference.
 *   - **Uncertain, hypothetical and quoted turns abstain.** Confidence below
 *     `GROWTH_MIN_CONFIDENCE`, a hypothesis marker, a role-play instruction or
 *     reported speech yields no evidence at all rather than a guess.
 *
 * The reliability weight is the analyser's own confidence, so a rule can never
 * claim more certainty than the reading it came from.
 */
export function deriveGrowthSignals(input: {
  /**
   * Only the reading itself is needed. Narrowing the type is what lets the
   * durable outbox pass the stored projection instead of a full analysis object
   * it deliberately does not keep.
   */
  analysis: Pick<CognitiveTurnAnalysis, 'intent' | 'confidenceScore' | 'uncertainty' | 'signals'> | undefined
  /** The user's own words for this turn. Required: style is stated, not inferred. */
  content?: string
  personalization?: readonly PersonalizationEntry[]
}): DerivedGrowthSignal[] {
  const analysis = input.analysis
  const content = input.content
  if (!analysis || typeof content !== 'string' || content.trim().length === 0) return []

  // Quoted or reported speech is not the user's own directive.
  const own = stripQuotedAndReportedText(content)
  if (own.trim().length === 0) return []
  // A hypothesis or a role play is not a preference.
  if (NON_ASSERTIVE.test(own)) return []

  const matched = STYLE_RULES.filter((rule) => rule.pattern.test(own))
  if (matched.length === 0) return []

  // An explicit style phrase is lexical evidence, and a lexical match is more
  // reliable than the intent classifier's routing label. "希望你能直接一点"
  // carries an unmistakable request even though the classifier calls the turn
  // `uncertain` at confidence 30 — that label is about what the user wants
  // *done*, not about what the sentence says. Abstaining on it lost two of the
  // three natural requests in the real-provider run.
  //
  // The abstention that remains is the one that is still about the sentence: a
  // reading that is both highly uncertain and below 25 confidence is not
  // something to move a dimension on, however suggestive the words are.
  if (analysis.uncertainty === 'high' && analysis.confidenceScore < 25) return []

  const weight = Math.min(1, Math.max(0.6, analysis.confidenceScore / 100))
  const byDimension = new Map<GrowthDimension, { net: number; sources: string[] }>()
  for (const rule of matched) {
    const aggregate = byDimension.get(rule.dimension) ?? { net: 0, sources: [] }
    aggregate.net += rule.polarity * rule.strength
    aggregate.sources.push(rule.source)
    byDimension.set(rule.dimension, aggregate)
  }

  const signals: DerivedGrowthSignal[] = []
  for (const [dimension, aggregate] of byDimension) {
    const net = Math.min(1, Math.max(-1, aggregate.net))
    // Perfect cancellation is not a weak preference; it is no evidence.
    if (Math.abs(net) < 1e-9) continue
    signals.push({ dimension, signal: Number(net.toFixed(4)), weight, source: aggregate.sources.join('+') })
  }
  return signals
}

export interface EffectivePersonality {
  warmth: number
  directness: number
  humor: number
  /** Per-dimension drift that produced the effective values. */
  offsets: Partial<Record<GrowthDimension, number>>
}

/** Applies the folded offsets to a baseline profile and clamps to 0–100. */
export function applyGrowth(
  baseline: { warmth: number; directness: number; humor: number },
  entries: readonly GrowthEntry[]
): EffectivePersonality {
  const offsets: Partial<Record<GrowthDimension, number>> = {}
  for (const entry of entries) {
    if (entry.offset !== 0) offsets[entry.dimension] = entry.offset
  }
  return {
    warmth: round(clamp(baseline.warmth + (offsets.warmth ?? 0), 0, 100)),
    directness: round(clamp(baseline.directness + (offsets.directness ?? 0), 0, 100)),
    humor: round(clamp(baseline.humor + (offsets.humor ?? 0), 0, 100)),
    offsets
  }
}

/**
 * One bounded line for the system prompt. It states the drift, the evidence
 * count and the fact that it is reversible; it never claims a feeling and never
 * carries permissions.
 */
export function describeGrowth(entries: readonly GrowthEntry[]): string {
  const moved = entries.filter((entry) => entry.offset !== 0)
  if (moved.length === 0) return ''
  const described = moved
    .map((entry) => `${entry.dimension} ${entry.offset > 0 ? '+' : ''}${entry.offset.toFixed(2)}`)
    .join(', ')
  const evidence = Math.max(...moved.map((entry) => entry.evidenceCount))
  return `Bounded style drift from the user-edited baseline (rule-derived, reversible, not a feeling): ${described} points on a 0-100 scale, from ${evidence} turns of evidence. The baseline the user set always wins when they conflict.`
}

export class PersonalityGrowthService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  /**
   * Records one turn's evidence atomically, then folds it.
   *
   * Insert and state write share one `BEGIN IMMEDIATE` transaction so a crash
   * cannot leave "signal stored, offset did not move". The insert is idempotent
   * on (dimension, turn), which is what makes a retried turn converge.
   */
  apply(input: GrowthSignalInput): GrowthEntry {
    if (!GROWTH_DIMENSIONS.includes(input.dimension)) throw new TypeError('Unknown growth dimension.')
    if (!uuidPattern.test(input.turnId)) throw new TypeError('Growth evidence requires a valid turn id.')
    if (!Number.isFinite(input.signal) || !Number.isFinite(input.weight)) throw new TypeError('Growth evidence requires finite signal and weight.')
    if (!Number.isFinite(Date.parse(input.at))) throw new TypeError('Growth evidence requires a valid timestamp.')

    const turnId = input.turnId.toLowerCase()
    const signal = round(clamp(input.signal, -1, 1))
    const weight = round(clamp(input.weight, 0, 1))
    const before = this.fold(input.dimension)

    this.database.connection.exec('BEGIN IMMEDIATE')
    try {
      this.database.connection.prepare(`
        INSERT INTO personality_growth_signals(dimension, turn_id, signal, weight, created_at, source)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(dimension, turn_id) DO NOTHING
      `).run(input.dimension, turnId, signal, weight, input.at, (input.source ?? 'unspecified').slice(0, 64))
      const after = this.fold(input.dimension)
      this.writeState(after, input.at, { bumpRevision: true })
      this.recordEvent({
        dimension: input.dimension,
        kind: after.applied ? 'applied' : 'withheld',
        before: before.offset,
        after: after.offset,
        evidenceCount: after.evidenceCount,
        reason: after.applied
          ? `${input.source ?? 'unspecified'}: signal ${signal} at weight ${weight}`
          : `evidence below gate (${after.evidenceCount}/${GROWTH_MIN_EVIDENCE})`,
        at: input.at
      })
      this.database.connection.exec('COMMIT')
      return after
    } catch (error) {
      try {
        this.database.connection.exec('ROLLBACK')
      } catch {
        // The transaction is already gone; surface the original failure.
      }
      throw error
    }
  }

  get(dimension: GrowthDimension): GrowthEntry {
    return this.fold(dimension)
  }

  list(): GrowthEntry[] {
    return GROWTH_DIMENSIONS.map((dimension) => this.fold(dimension))
  }

  /** Rebuilds every cached row from evidence; used by the consistency check. */
  recomputeAll(): GrowthEntry[] {
    const now = this.clock()
    return GROWTH_DIMENSIONS.map((dimension) => {
      const entry = this.fold(dimension)
      this.writeState(entry, now, { bumpRevision: false })
      return entry
    })
  }

  /**
   * Removes one turn's evidence. Message deletion calls this; the fold is
   * re-derived, so the offset drops back to what the remaining evidence supports.
   */
  forgetTurn(turnId: string): GrowthEntry[] {
    const id = turnId.toLowerCase()
    const affected = this.database.connection.prepare(
      'SELECT DISTINCT dimension FROM personality_growth_signals WHERE turn_id = ?'
    ).all(id) as Array<{ dimension: GrowthDimension }>
    this.database.connection.prepare('DELETE FROM personality_growth_signals WHERE turn_id = ?').run(id)
    const now = this.clock()
    return affected.map((row) => {
      const entry = this.fold(row.dimension)
      this.writeState(entry, now, { bumpRevision: true })
      return entry
    })
  }

  /**
   * Discards every signal for a dimension and records the rollback. This is the
   * user-facing "undo the drift" operation: the baseline was never touched, so
   * the effective profile returns to exactly what the user set.
   */
  rollback(dimension: GrowthDimension): GrowthEntry {
    const before = this.fold(dimension)
    const at = this.clock()
    this.database.connection.exec('BEGIN IMMEDIATE')
    try {
      this.database.connection.prepare('DELETE FROM personality_growth_signals WHERE dimension = ?').run(dimension)
      const after = this.fold(dimension)
      this.writeState(after, at, { bumpRevision: true })
      this.recordEvent({
        dimension,
        kind: 'rolled_back',
        before: before.offset,
        after: after.offset,
        evidenceCount: after.evidenceCount,
        reason: 'rolled back by request',
        at
      })
      this.database.connection.exec('COMMIT')
      return after
    } catch (error) {
      try {
        this.database.connection.exec('ROLLBACK')
      } catch {
        // Already rolled back; surface the original failure.
      }
      throw error
    }
  }

  /** Recent movements for one dimension, newest first. */
  history(dimension: GrowthDimension, limit = 20): Array<{ kind: string; before: number; after: number; reason: string; at: string }> {
    const rows = this.database.connection.prepare(`
      SELECT kind, offset_before, offset_after, reason, created_at
      FROM personality_growth_events WHERE dimension = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(dimension, limit) as Array<{ kind: string; offset_before: number; offset_after: number; reason: string; created_at: string }>
    return rows.map((row) => ({ kind: row.kind, before: row.offset_before, after: row.offset_after, reason: row.reason, at: row.created_at }))
  }

  private fold(dimension: GrowthDimension): GrowthEntry {
    const rows = this.database.connection.prepare(
      'SELECT dimension, turn_id, signal, weight, created_at FROM personality_growth_signals WHERE dimension = ? ORDER BY created_at, turn_id'
    ).all(dimension) as unknown as GrowthSignalRow[]
    const folded = foldGrowth(rows, this.clock())
    const cached = this.database.connection.prepare(
      'SELECT revision, updated_at FROM personality_growth_state WHERE dimension = ?'
    ).get(dimension) as { revision: number; updated_at: string } | undefined
    const last = rows.at(-1)
    return {
      dimension,
      offset: folded.offset,
      evidenceCount: folded.evidenceCount,
      applied: folded.applied,
      revision: cached?.revision ?? 0,
      updatedAt: last?.created_at ?? cached?.updated_at ?? this.clock(),
      lastTurnId: last?.turn_id ?? null
    }
  }

  private writeState(entry: GrowthEntry, at: string, options: { bumpRevision: boolean }): void {
    this.database.connection.prepare(`
      INSERT INTO personality_growth_state(dimension, offset, evidence_count, revision, updated_at, last_turn_id)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(dimension) DO UPDATE SET
        offset = excluded.offset,
        evidence_count = excluded.evidence_count,
        revision = personality_growth_state.revision + ?,
        updated_at = excluded.updated_at,
        last_turn_id = excluded.last_turn_id
    `).run(entry.dimension, entry.offset, entry.evidenceCount, at, entry.lastTurnId, options.bumpRevision ? 1 : 0)
  }

  private recordEvent(input: {
    dimension: GrowthDimension
    kind: 'applied' | 'withheld' | 'rolled_back'
    before: number
    after: number
    evidenceCount: number
    reason: string
    at: string
  }): void {
    this.database.connection.prepare(`
      INSERT INTO personality_growth_events(id, dimension, kind, offset_before, offset_after, evidence_count, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(this.makeId(), input.dimension, input.kind, input.before, input.after, input.evidenceCount, input.reason.slice(0, 200), input.at)
  }
}

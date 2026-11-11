/**
 * Morrow-owned trait formation (Issue #72 §5).
 *
 * Three layers stay separate:
 *   - `user_adaptation` lives in `personalization/personality-growth.ts` and is
 *     never read here;
 *   - a trait candidate is a bounded hypothesis formed only from Morrow's own
 *     appraisals/choices, never from a user's style request or praise;
 *   - a Morrow trait is a revision that passed the independence, consistency,
 *     time and counter-evidence gate.
 *
 * Gate:
 *   S = 0.30Q + 0.25I + 0.20X + 0.15R - 0.30K
 *   Q source quality, I independent conversations, X distinct contexts,
 *   R recency, K counter-evidence. A single turn can move the bounded strength
 *   by at most 0.12 and can never promote a trait.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'
import type { EmotionCandidate } from '../affective-state/emotion-model'

export const MORROW_TRAIT_VERSION = 'morrow-trait-v1'
export const MORROW_TRAIT_KEYS = ['curiosity', 'persistence', 'carefulness', 'openness', 'responsibility'] as const
export type MorrowTraitKey = typeof MORROW_TRAIT_KEYS[number]

export interface TraitDefinition {
  key: MorrowTraitKey
  halfLifeDays: number
  promotionThreshold: number
  weakeningThreshold: number
  minIndependentContexts: number
  minDistinctContexts: number
  minObservationHours: number
  cooldownHours: number
  maxStrengthStep: number
}

export const TRAIT_DEFINITIONS: Readonly<Record<MorrowTraitKey, Readonly<TraitDefinition>>> = Object.freeze({
  curiosity: { key: 'curiosity', halfLifeDays: 90, promotionThreshold: 0.62, weakeningThreshold: 0.45, minIndependentContexts: 3, minDistinctContexts: 2, minObservationHours: 24, cooldownHours: 168, maxStrengthStep: 0.12 },
  persistence: { key: 'persistence', halfLifeDays: 120, promotionThreshold: 0.66, weakeningThreshold: 0.48, minIndependentContexts: 3, minDistinctContexts: 2, minObservationHours: 24, cooldownHours: 168, maxStrengthStep: 0.12 },
  carefulness: { key: 'carefulness', halfLifeDays: 90, promotionThreshold: 0.64, weakeningThreshold: 0.47, minIndependentContexts: 3, minDistinctContexts: 2, minObservationHours: 24, cooldownHours: 168, maxStrengthStep: 0.12 },
  openness: { key: 'openness', halfLifeDays: 120, promotionThreshold: 0.64, weakeningThreshold: 0.46, minIndependentContexts: 3, minDistinctContexts: 2, minObservationHours: 24, cooldownHours: 168, maxStrengthStep: 0.12 },
  responsibility: { key: 'responsibility', halfLifeDays: 120, promotionThreshold: 0.68, weakeningThreshold: 0.5, minIndependentContexts: 3, minDistinctContexts: 2, minObservationHours: 24, cooldownHours: 168, maxStrengthStep: 0.12 }
})

export type TraitStatus = 'candidate' | 'active' | 'weakened' | 'conflict_pending' | 'rejected' | 'superseded' | 'retracted'

export interface TraitObservationInput {
  traitKey: MorrowTraitKey
  turnId: string
  conversationId: string
  sourceMessageId: string | null
  sourceEventId: string
  sourceKind: 'morrow_self_appraisal' | 'system_evidence'
  signal: number
  weight: number
  quality: number
  contextTag: string
  at: string
  makeId?: () => string
}

export interface TraitObservation extends TraitObservationInput {
  id: string
}

export interface TraitEvidenceRef {
  observationId: string
  turnId: string
  conversationId: string
  contextTag: string
  signal: number
  weight: number
  quality: number
  at: string
}

export interface MorrowTraitRevision {
  id: string
  traitKey: MorrowTraitKey
  actor: 'morrow'
  status: TraitStatus
  score: number
  strength: number
  evidenceCount: number
  independentContexts: number
  distinctContexts: number
  evidenceRefs: TraitEvidenceRef[]
  counterEvidenceRefs: TraitEvidenceRef[]
  revision: number
  supersedes: string | null
  rationale: string
  cooldownUntil: string | null
  algorithmVersion: string
  createdAt: string
  updatedAt: string
}

interface ObservationRow {
  id: string
  trait_key: string
  turn_id: string
  conversation_id: string
  source_message_id: string | null
  source_event_id: string
  source_kind: string
  signal: number
  weight: number
  quality: number
  context_tag: string
  created_at: string
}

interface RevisionRow {
  id: string
  trait_key: string
  actor: string
  status: string
  score: number
  strength: number
  evidence_count: number
  independent_contexts: number
  distinct_contexts: number
  evidence_json: string
  counter_evidence_json: string
  revision: number
  supersedes: string | null
  rationale: string
  cooldown_until: string | null
  algorithm_version: string
  created_at: string
  updated_at: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_OBSERVATIONS = 2000

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round4(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000
  return Object.is(rounded, -0) ? 0 : rounded
}

function decay(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return 1
  return Math.pow(2, -ageDays / halfLifeDays)
}

export interface TraitFold {
  score: number
  strength: number
  evidenceCount: number
  independentContexts: number
  distinctContexts: number
  spanHours: number
  quality: number
  independence: number
  consistency: number
  recency: number
  counterPenalty: number
  applied: boolean
  positiveRefs: TraitEvidenceRef[]
  counterRefs: TraitEvidenceRef[]
}

/** Pure fold over the observation ledger. */
export function foldTraitObservations(
  rows: readonly TraitObservation[],
  now: string,
  definition: TraitDefinition = TRAIT_DEFINITIONS.curiosity
): TraitFold {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new TypeError('Trait fold needs a valid timestamp.')
  const live = rows
    .filter((row) => Number.isFinite(Date.parse(row.at)))
    .map((row) => ({ row, atMs: Date.parse(row.at), ageDays: Math.max(0, (nowMs - Date.parse(row.at)) / 86_400_000) }))
    .filter(({ ageDays }) => ageDays <= definition.halfLifeDays * 4)
    .sort((left, right) => left.atMs - right.atMs)
  const positive = live.filter(({ row }) => row.signal > 0)
  const counter = live.filter(({ row }) => row.signal < 0)
  const refs = (entries: typeof live): TraitEvidenceRef[] => entries.map(({ row }) => ({
    observationId: row.id,
    turnId: row.turnId,
    conversationId: row.conversationId,
    contextTag: row.contextTag,
    signal: row.signal,
    weight: row.weight,
    quality: row.quality,
    at: row.at
  }))
  if (positive.length === 0) {
    return {
      score: 0, strength: 0, evidenceCount: 0, independentContexts: 0, distinctContexts: 0, spanHours: 0,
      quality: 0, independence: 0, consistency: 0, recency: 0, counterPenalty: counter.length > 0 ? 1 : 0,
      applied: false, positiveRefs: [], counterRefs: refs(counter)
    }
  }
  let weightSum = 0
  let qualitySum = 0
  let recencySum = 0
  let strength = 0
  let minAt = Number.POSITIVE_INFINITY
  let maxAt = 0
  for (const { row, ageDays } of positive) {
    const weight = clamp01(row.weight) * clamp01(row.quality)
    const recency = decay(ageDays, definition.halfLifeDays)
    weightSum += weight
    qualitySum += clamp01(row.quality) * weight
    recencySum += recency * weight
    strength += Math.min(definition.maxStrengthStep, definition.maxStrengthStep * clamp01(row.signal) * clamp01(row.weight) * clamp01(row.quality) * recency)
    minAt = Math.min(minAt, Date.parse(row.at))
    maxAt = Math.max(maxAt, Date.parse(row.at))
  }
  const independentContexts = new Set(positive.map(({ row }) => row.conversationId)).size
  const distinctContexts = new Set(positive.map(({ row }) => row.contextTag)).size
  const quality = weightSum > 0 ? qualitySum / weightSum : 0
  const independence = Math.min(1, independentContexts / definition.minIndependentContexts)
  const consistency = Math.min(1, distinctContexts / definition.minDistinctContexts)
  const recency = weightSum > 0 ? recencySum / weightSum : 0
  const counterPenalty = Math.min(1, counter.reduce((sum, { row }) => sum + Math.abs(row.signal) * clamp01(row.weight), 0) / 1.5)
  const score = clamp01(0.30 * quality + 0.25 * independence + 0.20 * consistency + 0.15 * recency - 0.30 * counterPenalty)
  const spanHours = (maxAt - minAt) / 3_600_000
  const applied = score >= definition.promotionThreshold &&
    independentContexts >= definition.minIndependentContexts &&
    distinctContexts >= definition.minDistinctContexts &&
    spanHours >= definition.minObservationHours
  return {
    score: round4(score),
    strength: round4(clamp01(strength - 0.2 * counterPenalty)),
    evidenceCount: positive.length + counter.length,
    independentContexts,
    distinctContexts,
    spanHours,
    quality: round4(quality),
    independence: round4(independence),
    consistency: round4(consistency),
    recency: round4(recency),
    counterPenalty: round4(counterPenalty),
    applied,
    positiveRefs: refs(positive),
    counterRefs: refs(counter)
  }
}

/** Maps an accepted emotion candidate to at most one trait observation. */
export function traitObservationFromEmotion(
  candidate: EmotionCandidate,
  input: { turnId: string; conversationId: string; sourceMessageId: string; sourceEventId: string; at: string }
): Omit<TraitObservationInput, 'makeId'> | null {
  if (!candidate.traitEligible) return null
  if (candidate.sourceKind !== 'morrow_self_appraisal' && candidate.sourceKind !== 'system_evidence') return null
  const mapping: Partial<Record<EmotionCandidate['family'], MorrowTraitKey>> = {
    curiosity: 'curiosity',
    frustration: 'responsibility',
    regret: 'responsibility',
    concern: 'carefulness',
    surprise: 'openness'
  }
  const traitKey = mapping[candidate.family]
  if (!traitKey) return null
  const contextTag = [...candidate.topicTags].filter((tag) => tag.trim().length >= 2).sort((left, right) => right.length - left.length)[0]?.slice(0, 64) ?? 'general'
  return {
    traitKey,
    turnId: input.turnId,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    sourceEventId: input.sourceEventId,
    sourceKind: candidate.sourceKind,
    signal: round4(clamp01(candidate.intensity * candidate.confidence)),
    weight: round4(candidate.confidence),
    quality: round4(clamp01(candidate.confidence * (candidate.sourceKind === 'morrow_self_appraisal' ? 1 : 0.85))),
    contextTag,
    at: input.at
  }
}

/** Negative, traceable counter-evidence from a Morrow-owned failure appraisal. */
export function counterObservationFromEmotion(
  candidate: EmotionCandidate,
  input: { turnId: string; conversationId: string; sourceMessageId: string; sourceEventId: string; at: string }
): Omit<TraitObservationInput, 'makeId'> | null {
  if (!candidate.traitEligible) return null
  if (candidate.sourceKind !== 'morrow_self_appraisal' && candidate.sourceKind !== 'system_evidence') return null
  const mapping: Partial<Record<EmotionCandidate['family'], MorrowTraitKey>> = {
    frustration: 'responsibility',
    regret: 'responsibility',
    disappointment: 'openness',
    concern: 'carefulness'
  }
  const traitKey = mapping[candidate.family]
  if (!traitKey) return null
  const base = [...candidate.topicTags].filter((tag) => tag.trim().length >= 2).sort((left, right) => right.length - left.length)[0]?.slice(0, 56) ?? 'general'
  return {
    traitKey,
    turnId: input.turnId,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    sourceEventId: input.sourceEventId,
    sourceKind: candidate.sourceKind,
    // Counter-evidence is deliberately stronger per event than the positive
    // observation it opposes; a single failure can weaken but not erase a
    // trait because the fold also needs repeated failures (K is bounded).
    signal: -round4(clamp01(candidate.intensity * 1.5) * candidate.confidence),
    weight: round4(candidate.confidence),
    quality: round4(clamp01(candidate.confidence * (candidate.sourceKind === 'morrow_self_appraisal' ? 1 : 0.85))),
    contextTag: `${base}:counter`.slice(0, 64),
    at: input.at
  }
}

export class MorrowTraitService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID(),
    private readonly events?: EventLogService
  ) {}

  get available(): boolean {
    return this.database.schemaVersion >= 55 && this.database.cognitivePersistenceAvailable
  }

  /** Records one observation. Idempotent on (traitKey, turnId, contextTag). */
  observeInTransaction(input: TraitObservationInput): MorrowTraitRevision | null {
    if (!this.available || !MORROW_TRAIT_KEYS.includes(input.traitKey)) return null
    if (!uuidPattern.test(input.turnId) || !uuidPattern.test(input.conversationId) || !uuidPattern.test(input.sourceEventId)) return null
    if (input.sourceMessageId !== null && !uuidPattern.test(input.sourceMessageId)) return null
    if (!Number.isFinite(input.signal) || !Number.isFinite(input.weight) || !Number.isFinite(input.quality) ||
      !Number.isFinite(Date.parse(input.at)) || !input.at.endsWith('Z')) return null
    if (!['morrow_self_appraisal', 'system_evidence'].includes(input.sourceKind)) return null
    const id = (input.makeId ?? this.makeId)().toLowerCase()
    const inserted = this.database.connection.prepare(`
      INSERT INTO morrow_trait_observations(
        id, trait_key, turn_id, conversation_id, source_message_id, source_event_id, source_kind,
        signal, weight, quality, context_tag, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trait_key, turn_id, context_tag) DO NOTHING
    `).run(
      id, input.traitKey, input.turnId.toLowerCase(), input.conversationId.toLowerCase(),
      input.sourceMessageId?.toLowerCase() ?? null, input.sourceEventId.toLowerCase(), input.sourceKind,
      Math.max(-1, Math.min(1, input.signal)), clamp01(input.weight), clamp01(input.quality),
      input.contextTag.slice(0, 64), input.at
    )
    if (Number(inserted.changes) === 0) return this.current(input.traitKey)
    if (this.countObservations() > MAX_OBSERVATIONS) {
      this.database.connection.prepare(`
        DELETE FROM morrow_trait_observations WHERE id IN (
          SELECT id FROM morrow_trait_observations ORDER BY created_at ASC LIMIT ?
        )
      `).run(this.countObservations() - MAX_OBSERVATIONS)
    }
    const revision = this.recompute(input.traitKey, input.at)
    this.events?.tryRecord({
      sourceModule: 'cognition',
      eventType: 'affect.trait_observed',
      actor: 'system',
      subjectType: 'morrow_trait',
      subjectId: input.traitKey,
      correlationId: input.turnId,
      payload: { status: revision.status, score: revision.score, strength: revision.strength, evidence: revision.evidenceCount }
    })
    return revision
  }

  observe(input: TraitObservationInput): MorrowTraitRevision | null {
    if (!this.available) return null
    return this.database.transaction(() => this.observeInTransaction(input))
  }

  /** Negative evidence. It is recorded, never silently dropped. */
  addCounterEvidence(input: TraitObservationInput): MorrowTraitRevision | null {
    if (input.signal >= 0) return null
    return this.observe({ ...input, signal: Math.min(-0.05, input.signal) })
  }

  retract(traitKey: MorrowTraitKey, rationale: string, at = this.clock()): MorrowTraitRevision | null {
    if (!this.available || !MORROW_TRAIT_KEYS.includes(traitKey)) return null
    const current = this.current(traitKey)
    const prior = current ?? this.baseRevision(traitKey, at)
    const next: MorrowTraitRevision = {
      ...prior,
      id: this.makeId().toLowerCase(),
      status: 'retracted',
      strength: 0,
      revision: prior.revision + 1,
      supersedes: current ? prior.id : null,
      rationale: rationale.slice(0, 1000),
      cooldownUntil: new Date(Date.parse(at) + TRAIT_DEFINITIONS[traitKey].cooldownHours * 3_600_000).toISOString(),
      createdAt: at,
      updatedAt: at
    }
    this.writeRevision(next, current?.id ?? null)
    return next
  }

  current(traitKey: MorrowTraitKey): MorrowTraitRevision | null {
    if (!this.available || !MORROW_TRAIT_KEYS.includes(traitKey)) return null
    const raw = this.currentRaw(traitKey)
    if (!raw) return null
    const count = Number(this.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM morrow_trait_observations WHERE trait_key = ?'
    ).get(traitKey)?.count ?? 0)
    // Single-message deletion cascades observations through the message FK. A
    // revision that still carries the old evidence count is stale; re-derive it
    // on read rather than waiting for the next startup.
    if (count !== raw.evidenceCount) return this.recompute(traitKey, this.clock(), raw)
    return raw
  }

  active(): MorrowTraitRevision[] {
    if (!this.available) return []
    const revisions = MORROW_TRAIT_KEYS.map((key) => this.current(key)).filter((revision): revision is MorrowTraitRevision => revision !== null)
    return revisions
      .filter((revision) => revision.status === 'active' || revision.status === 'weakened')
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
  }

  private currentRaw(traitKey: MorrowTraitKey): MorrowTraitRevision | null {
    const row = this.database.connection.prepare(`
      SELECT * FROM morrow_trait_revisions WHERE trait_key = ? AND status != 'superseded' ORDER BY revision DESC LIMIT 1
    `).get(traitKey) as unknown as RevisionRow | undefined
    return row ? mapRevision(row) : null
  }

  /** Bounded appraisal sensitivity input; no trait can decide an emotion. */
  activeStrengths(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const revision of this.active()) {
      if (revision.status === 'active') result[revision.traitKey] = revision.strength
    }
    return result
  }

  contextBlock(query: string, limit = 2): string {
    if (!this.available) return ''
    const active = this.active().filter((revision) => revision.status === 'active')
    if (active.length === 0) return ''
    const terms = new Set((query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length >= 2))
    const relevant = active.filter((revision) => {
      if (terms.size === 0) return true
      return revision.evidenceRefs.some((ref) => {
        const tag = ref.contextTag.normalize('NFKC').toLocaleLowerCase()
        return [...terms].some((term) => tag.includes(term) || term.includes(tag))
      })
    })
    const chosen = (terms.size === 0 ? active : relevant).slice(0, limit)
    if (chosen.length === 0) return ''
    const lines = chosen.map((revision) => `${revision.traitKey}（active，来自 ${revision.independentContexts} 个独立会话、${revision.distinctContexts} 类情境）`)
    return `Morrow's evidence-gated traits (stable only after independent evidence; they shape attention and appraisal sensitivity, never permissions or facts): ${lines.join('; ')}.`
  }

  clearAll(at = this.clock()): number {
    if (!this.available) return 0
    return this.database.transaction(() => {
      const removed = Number(this.database.connection.prepare('DELETE FROM morrow_trait_observations').run().changes)
      this.database.connection.prepare('DELETE FROM morrow_trait_revisions').run()
      this.database.connection.prepare('DELETE FROM morrow_trait_events').run()
      return removed
    })
  }

  deleteConversation(conversationId: string, at = this.clock()): number {
    if (!this.available) return 0
    const removed = Number(this.database.connection.prepare(
      'DELETE FROM morrow_trait_observations WHERE conversation_id = ?'
    ).run(conversationId.toLowerCase()).changes)
    // FK cascade may have removed the rows already; always re-derive so a
    // trait revision cannot survive its deleted evidence.
    this.recomputeAll(at)
    return removed
  }

  recomputeAll(at = this.clock()): MorrowTraitRevision[] {
    if (!this.available) return []
    return MORROW_TRAIT_KEYS.map((key) => this.recompute(key, at))
  }

  private recompute(traitKey: MorrowTraitKey, at: string, priorOverride?: MorrowTraitRevision): MorrowTraitRevision {
    const rows = this.database.connection.prepare(
      'SELECT * FROM morrow_trait_observations WHERE trait_key = ? ORDER BY created_at, id'
    ).all(traitKey) as unknown as ObservationRow[]
    const observations = rows.map(mapObservation)
    const prior = priorOverride ?? this.currentRaw(traitKey)
    const definition = TRAIT_DEFINITIONS[traitKey]
    const folded = foldTraitObservations(observations, at, definition)
    const priorStatus = prior?.status ?? null
    let status: TraitStatus = 'candidate'
    if (priorStatus === 'retracted' && prior?.cooldownUntil && Date.parse(prior.cooldownUntil) > Date.parse(at)) {
      status = 'retracted'
    } else if (folded.counterRefs.length > 0 && !folded.applied) {
      status = priorStatus === 'active' ? 'weakened' : 'conflict_pending'
    } else if (priorStatus === 'active' && folded.counterRefs.length > 0) {
      // Counter-evidence changes the status before it erases the trait; the
      // strength and the evidence remain auditable, so a later run can recover.
      status = 'weakened'
    } else if (priorStatus === 'active' && (folded.strength < 0.18 || folded.score < definition.weakeningThreshold)) {
      status = 'weakened'
    } else if (folded.applied && folded.strength >= 0.22) {
      status = 'active'
    } else if (folded.score >= 0.35) {
      status = 'candidate'
    }
    const changed = !prior || prior.status !== status || Math.abs(prior.score - folded.score) >= 0.005 ||
      Math.abs(prior.strength - folded.strength) >= 0.005 || prior.evidenceCount !== folded.evidenceCount
    const base = prior ?? this.baseRevision(traitKey, at)
    const next: MorrowTraitRevision = {
      ...base,
      id: changed ? this.makeId().toLowerCase() : base.id,
      status,
      score: folded.score,
      strength: folded.strength,
      evidenceCount: folded.evidenceCount,
      independentContexts: folded.independentContexts,
      distinctContexts: folded.distinctContexts,
      evidenceRefs: folded.positiveRefs.slice(-40),
      counterEvidenceRefs: folded.counterRefs.slice(-20),
      revision: changed ? (prior ? prior.revision + 1 : 1) : base.revision,
      supersedes: changed && prior ? prior.id : null,
      rationale: `Q=${folded.quality} I=${folded.independence} X=${folded.consistency} R=${folded.recency} K=${folded.counterPenalty} spanH=${Math.round(folded.spanHours)} strength=${folded.strength}`,
      cooldownUntil: status === 'active' ? new Date(Date.parse(at) + definition.cooldownHours * 3_600_000).toISOString() : base.cooldownUntil,
      createdAt: changed ? at : base.createdAt,
      updatedAt: at
    }
    if (changed) this.writeRevision(next, prior?.id ?? null)
    return next
  }

  private baseRevision(traitKey: MorrowTraitKey, at: string): MorrowTraitRevision {
    return {
      id: this.makeId().toLowerCase(),
      traitKey,
      actor: 'morrow',
      status: 'candidate',
      score: 0,
      strength: 0,
      evidenceCount: 0,
      independentContexts: 0,
      distinctContexts: 0,
      evidenceRefs: [],
      counterEvidenceRefs: [],
      revision: 0,
      supersedes: null,
      rationale: 'no observation yet',
      cooldownUntil: null,
      algorithmVersion: MORROW_TRAIT_VERSION,
      createdAt: at,
      updatedAt: at
    }
  }

  private writeRevision(revision: MorrowTraitRevision, priorId: string | null): void {
    if (Number(revision.revision) < 1) return
    this.database.connection.prepare(`
      INSERT INTO morrow_trait_revisions(
        id, trait_key, actor, status, score, strength, evidence_count, independent_contexts, distinct_contexts,
        evidence_json, counter_evidence_json, revision, supersedes, rationale, cooldown_until, algorithm_version,
        created_at, updated_at
      ) VALUES (?, ?, 'morrow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id, revision.traitKey, revision.status, revision.score, revision.strength, revision.evidenceCount,
      revision.independentContexts, revision.distinctContexts, JSON.stringify(revision.evidenceRefs),
      JSON.stringify(revision.counterEvidenceRefs), revision.revision, priorId, revision.rationale.slice(0, 1000),
      revision.cooldownUntil, revision.algorithmVersion, revision.createdAt, revision.updatedAt
    )
    if (priorId) {
      this.database.connection.prepare(
        "UPDATE morrow_trait_revisions SET status = 'superseded' WHERE id = ? AND status != 'superseded'"
      ).run(priorId)
    }
    this.database.connection.prepare(`
      INSERT INTO morrow_trait_events(id, trait_key, kind, score_before, score_after, evidence_count, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.makeId(), revision.traitKey,
      revision.status === 'active' ? 'promoted' : revision.status === 'weakened' ? 'weakened' : revision.status === 'retracted' ? 'retracted' : 'observed',
      0, revision.score, revision.evidenceCount, revision.rationale.slice(0, 240), revision.updatedAt
    )
  }

  private countObservations(): number {
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM morrow_trait_observations').get()?.count ?? 0)
  }
}

function mapObservation(row: ObservationRow): TraitObservation {
  return {
    id: row.id,
    traitKey: row.trait_key as MorrowTraitKey,
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    sourceEventId: row.source_event_id,
    sourceKind: row.source_kind as TraitObservationInput['sourceKind'],
    signal: row.signal,
    weight: row.weight,
    quality: row.quality,
    contextTag: row.context_tag,
    at: row.created_at
  }
}

function mapRevision(row: RevisionRow): MorrowTraitRevision {
  let evidenceRefs: TraitEvidenceRef[] = []
  let counterEvidenceRefs: TraitEvidenceRef[] = []
  try { evidenceRefs = JSON.parse(row.evidence_json) } catch { evidenceRefs = [] }
  try { counterEvidenceRefs = JSON.parse(row.counter_evidence_json) } catch { counterEvidenceRefs = [] }
  return {
    id: row.id,
    traitKey: row.trait_key as MorrowTraitKey,
    actor: 'morrow',
    status: row.status as TraitStatus,
    score: row.score,
    strength: row.strength,
    evidenceCount: row.evidence_count,
    independentContexts: row.independent_contexts,
    distinctContexts: row.distinct_contexts,
    evidenceRefs,
    counterEvidenceRefs,
    revision: row.revision,
    supersedes: row.supersedes,
    rationale: row.rationale,
    cooldownUntil: row.cooldown_until,
    algorithmVersion: row.algorithm_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Versioned algorithm marker for reports and persisted rows. */
export const TRAIT_ALGORITHM_VERSION = MORROW_TRAIT_VERSION

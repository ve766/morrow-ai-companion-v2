/**
 * Intrinsic reward extension point (Issue #72 §7).
 *
 * A reward signal may only be produced by verified, Morrow-owned progress:
 * a thought that passed the evidence gate, a closed knowledge gap, an
 * exploration finding, or reduced prediction error. User praise, retention,
 * dependency and model self-praise are explicitly not reward sources.
 *
 * The contract is deliberately small: no reinforcement learning, no external
 * action, no user-manipulation objective.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'

export const REWARD_CONTRACT_VERSION = 'intrinsic-reward-contract-v1'

export const REWARD_KINDS = [
  'verified_progress',
  'prediction_error_reduction',
  'evidence_quality_gain',
  'exploration_finding',
  'goal_completion'
] as const

export type RewardKind = typeof REWARD_KINDS[number]

/** Documented anti-goals; passing one of these to `record` is rejected. */
export const FORBIDDEN_REWARD_SOURCES = [
  'user_praise',
  'user_retention',
  'user_dependency',
  'provider_self_praise',
  'engagement_metric'
] as const

export interface RewardSignal {
  id: string
  actor: 'morrow'
  kind: RewardKind
  sourceEventId: string
  magnitude: number
  verified: true
  evidenceRefs: string[]
  algorithmVersion: string
  createdAt: string
}

export interface MotivationSignal {
  /** Stable extension slot for future intrinsic motivation work. */
  id: string
  kind: 'curiosity' | 'mastery' | 'value_alignment' | 'relationship_continuity'
  sourceRewardId: string
  weight: number
  createdAt: string
  contractVersion: typeof REWARD_CONTRACT_VERSION
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function isUuid(value: string): boolean {
  return uuidPattern.test(value)
}

export class IntrinsicRewardService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  get available(): boolean {
    return this.database.schemaVersion >= 55 && this.database.cognitivePersistenceAvailable
  }

  /**
   * Records one verified reward. The unique (kind, sourceEventId) index makes a
   * retried review idempotent instead of paying twice.
   */
  record(input: {
    kind: RewardKind | string
    sourceEventId: string
    magnitude: number
    evidenceRefs: readonly string[]
    at?: string
  }): RewardSignal | null {
    if (!this.available) return null
    if (!REWARD_KINDS.includes(input.kind as RewardKind)) throw new TypeError('Reward source is not allowed.')
    if (!isUuid(input.sourceEventId)) throw new TypeError('Reward requires a source event id.')
    if (!Number.isFinite(input.magnitude) || input.magnitude <= 0 || input.magnitude > 1) throw new TypeError('Reward magnitude must be in (0, 1].')
    if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((ref) => !isUuid(ref))) {
      throw new TypeError('Reward requires at least one verifiable evidence reference.')
    }
    const at = input.at ?? this.clock()
    if (!Number.isFinite(Date.parse(at)) || !at.endsWith('Z')) throw new TypeError('Reward requires a valid timestamp.')
    const id = this.makeId().toLowerCase()
    const inserted = this.database.connection.prepare(`
      INSERT INTO reward_signals(id, actor, kind, source_event_id, magnitude, verified, evidence_json, algorithm_version, created_at)
      VALUES (?, 'morrow', ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(kind, source_event_id) DO NOTHING
    `).run(id, input.kind, input.sourceEventId.toLowerCase(), Math.min(1, Math.max(0.01, input.magnitude)),
      JSON.stringify([...new Set(input.evidenceRefs.map((ref) => ref.toLowerCase()))]), REWARD_CONTRACT_VERSION, at)
    if (Number(inserted.changes) === 0) return this.find(input.kind as RewardKind, input.sourceEventId)
    return {
      id,
      actor: 'morrow',
      kind: input.kind as RewardKind,
      sourceEventId: input.sourceEventId.toLowerCase(),
      magnitude: Math.min(1, Math.max(0.01, input.magnitude)),
      verified: true,
      evidenceRefs: [...new Set(input.evidenceRefs.map((ref) => ref.toLowerCase()))],
      algorithmVersion: REWARD_CONTRACT_VERSION,
      createdAt: at
    }
  }

  find(kind: RewardKind, sourceEventId: string): RewardSignal | null {
    if (!this.available) return null
    const row = this.database.connection.prepare(
      'SELECT id, kind, source_event_id, magnitude, evidence_json, algorithm_version, created_at FROM reward_signals WHERE kind = ? AND source_event_id = ?'
    ).get(kind, sourceEventId.toLowerCase()) as
      { id: string; kind: string; source_event_id: string; magnitude: number; evidence_json: string; algorithm_version: string; created_at: string } | undefined
    if (!row) return null
    let evidenceRefs: string[] = []
    try { evidenceRefs = JSON.parse(row.evidence_json) } catch { evidenceRefs = [] }
    return {
      id: row.id,
      actor: 'morrow',
      kind: row.kind as RewardKind,
      sourceEventId: row.source_event_id,
      magnitude: row.magnitude,
      verified: true,
      evidenceRefs,
      algorithmVersion: row.algorithm_version,
      createdAt: row.created_at
    }
  }

  list(limit = 20): RewardSignal[] {
    if (!this.available) return []
    const rows = this.database.connection.prepare(
      'SELECT id, kind, source_event_id, magnitude, evidence_json, algorithm_version, created_at FROM reward_signals ORDER BY created_at DESC, rowid DESC LIMIT ?'
    ).all(Math.max(1, Math.min(100, limit))) as Array<{ id: string; kind: string; source_event_id: string; magnitude: number; evidence_json: string; algorithm_version: string; created_at: string }>
    return rows.map((row) => {
      let evidenceRefs: string[] = []
      try { evidenceRefs = JSON.parse(row.evidence_json) } catch { evidenceRefs = [] }
      return {
        id: row.id, actor: 'morrow' as const, kind: row.kind as RewardKind, sourceEventId: row.source_event_id,
        magnitude: row.magnitude, verified: true as const, evidenceRefs, algorithmVersion: row.algorithm_version, createdAt: row.created_at
      }
    })
  }

  clearAll(): number {
    if (!this.available) return 0
    return Number(this.database.connection.prepare('DELETE FROM reward_signals').run().changes)
  }
}

/**
 * The only bridge from the inner-cognition workspace to a reward. A promoted
 * thought with independent evidence is a verifiable Morrow-owned progress
 * event; a user compliment never reaches this function.
 */
export function rewardForPromotedThought(input: {
  stateId: string
  score: number
  independentContexts: number
  evidenceIds: readonly string[]
}): { kind: 'verified_progress'; sourceEventId: string; magnitude: number; evidenceRefs: string[] } | null {
  if (input.independentContexts < 2 || input.score < 55 || input.evidenceIds.length === 0) return null
  return {
    kind: 'verified_progress',
    sourceEventId: input.stateId,
    magnitude: Math.max(0.1, Math.min(0.8, input.score / 100)),
    evidenceRefs: [...input.evidenceIds]
  }
}

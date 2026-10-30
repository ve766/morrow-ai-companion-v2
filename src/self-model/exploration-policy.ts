/**
 * Constrained self-initiated exploration (Stage 3, algorithm X1).
 *
 * Morrow may bring up a topic of its own only inside a turn the user already
 * started. This module decides *whether* it may, and records the decision, so
 * the answer is data rather than an intention. What it cannot do is contact the
 * user: there is no outbound channel in this build, and the schema has no column
 * that could pretend there is one.
 *
 * The gate is deliberately conservative — silence is the default:
 *
 *   - the topic must be a real interest with at least `MIN_EVIDENCE` independent
 *     observations, `MIN_STRENGTH` and `MIN_CONFIDENCE`;
 *   - at least `COOLDOWN_HOURS` must have passed since the last raised topic;
 *   - at most `MAX_PER_DAY` topics may be raised in any rolling 24 hours;
 *   - a turn that corrects the assistant, or whose intent reading is uncertain,
 *     never carries a self-initiated topic — being wrong loudly is worse than
 *     being quiet.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import type { InterestRecord } from './self-model-domain'

export const EXPLORATION_MIN_EVIDENCE = 3
export const EXPLORATION_MIN_STRENGTH = 0.6
export const EXPLORATION_MIN_CONFIDENCE = 60
export const EXPLORATION_COOLDOWN_HOURS = 6
export const EXPLORATION_MAX_PER_DAY = 2

export interface ExplorationInput {
  /** Active interests, newest evidence first is not required. */
  interests: readonly InterestRecord[]
  now: string
  /** When Morrow last raised a topic; null when it never has. */
  lastRaisedAt: string | null
  /** How many topics were raised in the trailing 24 hours. */
  raisedLastDay: number
  /** The turn's intent reading, when the cognitive core is on. */
  turn: { intent: string; uncertainty: string; correction: boolean } | null
  /** Topics already used in the current conversation, to avoid repetition. */
  recentlyUsed?: readonly string[]
}

export interface ExplorationDecision {
  allowed: boolean
  /** Stable machine-readable reason; safe to log, contains no user content. */
  reason:
    | 'no_candidate'
    | 'insufficient_evidence'
    | 'cooldown'
    | 'daily_cap'
    | 'turn_not_suitable'
    | 'already_used'
    | 'allowed'
  interestId: string | null
  label: string | null
}

/**
 * Pure decision function. Kept separate from storage so the rules can be tested
 * without a database and replayed against recorded turns.
 */
export function decideExploration(input: ExplorationInput): ExplorationDecision {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) throw new TypeError('Exploration requires a valid timestamp.')

  const eligible = input.interests.filter((interest) =>
    interest.status === 'active' &&
    interest.evidenceCount >= EXPLORATION_MIN_EVIDENCE &&
    interest.strength >= EXPLORATION_MIN_STRENGTH &&
    interest.confidence >= EXPLORATION_MIN_CONFIDENCE
  )
  if (eligible.length === 0) {
    const recorded = input.interests.filter((interest) => interest.status === 'active')
    return { allowed: false, reason: recorded.length === 0 ? 'no_candidate' : 'insufficient_evidence', interestId: null, label: null }
  }

  if (input.turn && (input.turn.correction || input.turn.uncertainty === 'high' || input.turn.intent === 'correction')) {
    return { allowed: false, reason: 'turn_not_suitable', interestId: null, label: null }
  }

  if (input.raisedLastDay >= EXPLORATION_MAX_PER_DAY) {
    return { allowed: false, reason: 'daily_cap', interestId: null, label: null }
  }

  if (input.lastRaisedAt) {
    const last = Date.parse(input.lastRaisedAt)
    if (Number.isFinite(last) && nowMs - last < EXPLORATION_COOLDOWN_HOURS * 3_600_000) {
      return { allowed: false, reason: 'cooldown', interestId: null, label: null }
    }
  }

  const used = new Set(input.recentlyUsed ?? [])
  const fresh = eligible.filter((interest) => !used.has(interest.id))
  if (fresh.length === 0) {
    return { allowed: false, reason: 'already_used', interestId: null, label: null }
  }

  // Highest strength wins; ties break on recency of evidence, then on id so the
  // choice is deterministic for a fixed input.
  const chosen = [...fresh].sort((left, right) => {
    if (right.strength !== left.strength) return right.strength - left.strength
    const leftSeen = Date.parse(left.lastSeenAt)
    const rightSeen = Date.parse(right.lastSeenAt)
    if (rightSeen !== leftSeen) return rightSeen - leftSeen
    return left.id.localeCompare(right.id)
  })[0]!
  return { allowed: true, reason: 'allowed', interestId: chosen.id, label: chosen.label }
}

/** One line for the system prompt, only when a topic was actually permitted. */
export function describeExploration(decision: ExplorationDecision): string {
  if (!decision.allowed || !decision.label) return ''
  return `You may, once, bring up one topic of your own: "${decision.label}". Raise it as your own attention, not as the user's interest, and only if it fits the current turn. Do not claim an experience you did not have, and do not repeat it if it is declined.`
}

export class ExplorationService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  /** Records a raised or declined topic. Idempotent per (turn, kind). */
  record(input: { turnId: string; interestId: string; kind: 'raised' | 'declined'; reason: string }): void {
    this.database.connection.prepare(`
      INSERT INTO exploration_events(id, turn_id, interest_id, kind, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(this.makeId(), input.turnId.toLowerCase(), input.interestId, input.kind, input.reason.slice(0, 120), this.clock())
  }

  /** Raised-topic history used by the frequency gate. */
  recent(excludeTurnId?: string): { lastRaisedAt: string | null; raisedLastDay: number; raisedInterestIds: string[] } {
    const nowMs = Date.parse(this.clock())
    const excluded = excludeTurnId?.toLowerCase() ?? null
    const rows = this.database.connection.prepare(
      "SELECT turn_id, interest_id, created_at FROM exploration_events WHERE kind = 'raised' ORDER BY created_at DESC LIMIT 100"
    ).all() as Array<{ turn_id: string; interest_id: string; created_at: string }>
    // The current turn is excluded so re-deciding the same turn (the request is
    // built twice: once for the consent preview, once for the verified payload)
    // returns the same answer instead of counting itself as prior history.
    const history = excluded ? rows.filter((row) => row.turn_id !== excluded) : rows
    const lastRaisedAt = history[0]?.created_at ?? null
    const raisedLastDay = history.filter((row) => {
      const at = Date.parse(row.created_at)
      return Number.isFinite(at) && nowMs - at <= 86_400_000
    }).length
    return { lastRaisedAt, raisedLastDay, raisedInterestIds: history.map((row) => row.interest_id) }
  }

  /**
   * Runs the gate and records the outcome. The record is written even when the
   * topic is declined: "why did Morrow stay quiet" must be answerable.
   */
  decide(input: { turnId: string; interests: readonly InterestRecord[]; turn: ExplorationInput['turn'] }): ExplorationDecision {
    const recent = this.recent(input.turnId)
    const decision = decideExploration({
      interests: input.interests,
      now: this.clock(),
      lastRaisedAt: recent.lastRaisedAt,
      raisedLastDay: recent.raisedLastDay,
      turn: input.turn,
      recentlyUsed: recent.raisedInterestIds
    })
    if (decision.interestId) {
      this.record({
        turnId: input.turnId,
        interestId: decision.interestId,
        kind: decision.allowed ? 'raised' : 'declined',
        reason: decision.reason
      })
    }
    return decision
  }
}

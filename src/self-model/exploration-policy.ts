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
    | 'no_morrow_candidate'
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

  // Only a topic Morrow owns may be raised as hers. A user interest is not
  // eligible no matter how strong it is: "the user talks about X" is not
  // "Morrow wants to talk about X".
  const owned = input.interests.filter((interest) => interest.origin === 'morrow' || interest.origin === 'shared')
  const eligible = owned.filter((interest) =>
    interest.status === 'active' &&
    interest.evidenceCount >= EXPLORATION_MIN_EVIDENCE &&
    interest.strength >= EXPLORATION_MIN_STRENGTH &&
    interest.confidence >= EXPLORATION_MIN_CONFIDENCE
  )
  if (eligible.length === 0) {
    const recorded = owned.filter((interest) => interest.status === 'active')
    // Distinguish "nothing at all" from "the user has interests but Morrow has
    // none of her own" — the second is the common case and must not be reported
    // as if there were no candidates.
    const reason = input.interests.length === 0 ? 'no_candidate' : recorded.length === 0 ? 'no_morrow_candidate' : 'insufficient_evidence'
    return { allowed: false, reason, interestId: null, label: null }
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

export type ExplorationState =
  | 'permitted'
  | 'selected_for_prompt'
  | 'actually_raised'
  | 'not_raised'
  | 'provider_failed'
  | 'user_rejected'

/**
 * Decides whether a persisted reply actually raised the topic.
 *
 * This is a *detector*, not a judge. It only reports `raised` when the reply
 * contains the topic's own terms; a reply that says nothing about it is
 * `not_raised`, and a reply too short to judge is `uncertain` — which is
 * recorded as `not_raised` and never counted as a success. Pretending a
 * heuristic can recognise a natural topic change would be worse than admitting
 * it cannot.
 */
export function detectRaised(reply: string, label: string): 'raised' | 'not_raised' | 'uncertain' {
  const text = reply.normalize('NFKC').toLocaleLowerCase()
  const terms = label.normalize('NFKC').toLocaleLowerCase()
    .split(/[\s，。！？、；：,.!?;:()（）\[\]"'“”‘’]+/u)
    .filter((term) => term.length >= 2)
  if (terms.length === 0) return 'uncertain'
  if (text.trim().length < 4) return 'uncertain'
  return terms.some((term) => text.includes(term)) ? 'raised' : 'not_raised'
}

export class ExplorationService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID(),
    private readonly scope: string = 'install'
  ) {}

  private day(): string {
    return this.clock().slice(0, 10)
  }

  /**
   * Atomically reserves one slot of today's budget.
   *
   * The reservation row is written inside `BEGIN IMMEDIATE` *before* the answer is
   * returned, and the count includes reserved as well as consumed rows. Two turns
   * racing for the last slot therefore cannot both succeed: the second one blocks
   * on the write lock, then sees the first row.
   *
   * Idempotent on `(scope, day, turn_id)`: a retried or re-prepared turn reads its
   * own row instead of reserving another.
   */
  reserve(turnId: string): 'reserved' | 'consumed' | 'denied' {
    const id = turnId.toLowerCase()
    const day = this.day()
    this.database.connection.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.database.connection.prepare(
        'SELECT state FROM exploration_budget WHERE scope = ? AND day = ? AND turn_id = ?'
      ).get(this.scope, day, id) as { state: string } | undefined
      if (existing) {
        this.database.connection.exec('COMMIT')
        return existing.state === 'consumed' ? 'consumed' : existing.state === 'denied' ? 'denied' : 'reserved'
      }
      const used = Number((this.database.connection.prepare(
        "SELECT COUNT(*) AS n FROM exploration_budget WHERE scope = ? AND day = ? AND state IN ('reserved', 'consumed')"
      ).get(this.scope, day) as { n: number }).n)
      const state = used >= EXPLORATION_MAX_PER_DAY ? 'denied' : 'reserved'
      this.database.connection.prepare(
        'INSERT INTO exploration_budget(scope, day, turn_id, state, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(this.scope, day, id, state, this.clock())
      this.database.connection.exec('COMMIT')
      return state
    } catch (error) {
      try { this.database.connection.exec('ROLLBACK') } catch { /* already gone */ }
      throw error
    }
  }

  /** Turns a reservation into a real raise. Idempotent. */
  consume(turnId: string): boolean {
    const result = this.database.connection.prepare(
      "UPDATE exploration_budget SET state = 'consumed' WHERE scope = ? AND day = ? AND turn_id = ? AND state IN ('reserved', 'consumed')"
    ).run(this.scope, this.day(), turnId.toLowerCase())
    return Number(result.changes) > 0
  }

  /** Gives the slot back when the turn never actually raised the topic. */
  release(turnId: string): boolean {
    const result = this.database.connection.prepare(
      "UPDATE exploration_budget SET state = 'released' WHERE scope = ? AND day = ? AND turn_id = ? AND state = 'reserved'"
    ).run(this.scope, this.day(), turnId.toLowerCase())
    return Number(result.changes) > 0
  }

  /** How many slots today have been reserved or consumed. */
  usedToday(): number {
    return Number((this.database.connection.prepare(
      "SELECT COUNT(*) AS n FROM exploration_budget WHERE scope = ? AND day = ? AND state IN ('reserved', 'consumed')"
    ).get(this.scope, this.day()) as { n: number }).n)
  }

  /**
   * Records one lifecycle state for a turn.
   *
   * Idempotent by construction: the unique index on (turn_id, state) means a
   * retried turn, a repeated `prepare` or a crash-recovery replay inserts
   * nothing new. Writing a state that already exists is a no-op, not an error.
   */
  private transition(input: { turnId: string; interestId: string; state: ExplorationState; reason: string }): void {
    this.database.connection.prepare(`
      INSERT INTO exploration_events(id, turn_id, interest_id, state, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id, state) DO NOTHING
    `).run(this.makeId(), input.turnId.toLowerCase(), input.interestId, input.state, input.reason.slice(0, 120), this.clock())
  }

  /** The permission actually reached the serialized prompt. */
  markSelected(input: { turnId: string; interestId: string; reason?: string }): void {
    this.transition({ turnId: input.turnId, interestId: input.interestId, state: 'selected_for_prompt', reason: input.reason ?? 'in_payload' })
  }

  /**
   * Settles a turn after the provider call.
   *
   * Only `actually_raised` keeps the budget slot. A failed call, a cancelled one,
   * or a reply that never mentions the topic releases it — the gate must not be
   * consumed by a turn that never happened.
   */
  settle(input: {
    turnId: string
    interestId: string
    label: string
    outcome: 'succeeded' | 'failed' | 'cancelled'
    reply: string | null
  }): 'actually_raised' | 'not_raised' | 'provider_failed' {
    if (input.outcome !== 'succeeded' || input.reply === null) {
      this.transition({ turnId: input.turnId, interestId: input.interestId, state: 'provider_failed', reason: input.outcome })
      this.release(input.turnId)
      return 'provider_failed'
    }
    const detected = detectRaised(input.reply, input.label)
    const state: 'actually_raised' | 'not_raised' = detected === 'raised' ? 'actually_raised' : 'not_raised'
    this.transition({ turnId: input.turnId, interestId: input.interestId, state, reason: detected })
    if (state === 'actually_raised') this.consume(input.turnId)
    else this.release(input.turnId)
    return state
  }

  /** The user dismissed the topic (archived / dropped the interest). */
  markUserRejected(input: { turnId: string; interestId: string; reason: string }): void {
    this.transition({ ...input, state: 'user_rejected' })
    this.release(input.turnId)
  }

  /**
   * Frequency state, counted from `actually_raised` only.
   *
   * `excludeTurnId` keeps the current turn out of its own history, so the
   * preview and the verified payload reach the same decision.
   */
  recent(excludeTurnId?: string): { lastRaisedAt: string | null; raisedLastDay: number; raisedInterestIds: string[] } {
    const nowMs = Date.parse(this.clock())
    const excluded = excludeTurnId?.toLowerCase() ?? null
    const rows = this.database.connection.prepare(
      "SELECT turn_id, interest_id, created_at FROM exploration_events WHERE state = 'actually_raised' ORDER BY created_at DESC LIMIT 100"
    ).all() as Array<{ turn_id: string; interest_id: string; created_at: string }>
    const history = excluded ? rows.filter((row) => row.turn_id !== excluded) : rows
    const lastRaisedAt = history[0]?.created_at ?? null
    const raisedLastDay = history.filter((row) => {
      const at = Date.parse(row.created_at)
      return Number.isFinite(at) && nowMs - at <= 86_400_000
    }).length
    return { lastRaisedAt, raisedLastDay, raisedInterestIds: history.map((row) => row.interest_id) }
  }

  /** Every state recorded for one turn, oldest first. Used by the audit trail. */
  history(turnId: string): Array<{ state: ExplorationState; interestId: string; reason: string; at: string }> {
    const rows = this.database.connection.prepare(
      'SELECT state, interest_id, reason, created_at FROM exploration_events WHERE turn_id = ? ORDER BY created_at, rowid'
    ).all(turnId.toLowerCase()) as Array<{ state: ExplorationState; interest_id: string; reason: string; created_at: string }>
    return rows.map((row) => ({ state: row.state, interestId: row.interest_id, reason: row.reason, at: row.created_at }))
  }

  /**
   * Runs the gate, reserves a budget slot, and records only the *permission*.
   *
   * Nothing here claims the topic was raised; that is decided after the reply is
   * persisted, by `settle()`. A denied reservation keeps the read-only signals
   * (cooldown, suitability) ahead of the budget so the recorded reason stays
   * truthful.
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
    if (!decision.allowed) return decision

    const reservation = this.reserve(input.turnId)
    if (reservation === 'denied') {
      this.transition({ turnId: input.turnId, interestId: decision.interestId!, state: 'not_raised', reason: 'budget_denied' })
      return { allowed: false, reason: 'daily_cap', interestId: null, label: null }
    }
    this.transition({ turnId: input.turnId, interestId: decision.interestId!, state: 'permitted', reason: decision.reason })
    return decision
  }
}

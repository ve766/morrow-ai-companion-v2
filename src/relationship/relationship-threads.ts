/**
 * Relationship continuity (Stage 5, delivery A).
 *
 * A "thread" is a low-sensitivity continuity note the user themselves stated:
 * how they want to be addressed, a topic both sides agreed to continue, a
 * commitment with progress, or an explicit interaction-rhythm preference. It is
 * deliberately NOT a user profile and never infers intimacy, dependency,
 * identity, health or any other sensitive attribute — the extractor only fires
 * on explicit, first-person statements and the fields carry no free text beyond
 * the short value the user gave.
 *
 * Evidence model (the formula lives here, not only in docs):
 *
 *   score(x, t) = clip( Σ_g  w_g · s_g · exp(−ln2 · ageDays_g / halfLife_g), 0, 1 )
 *
 *   g          — one independent source group (a distinct user message)
 *   w_g        — source weight (explicit statement 1.0; weaker cues are not
 *                extracted at all, so in practice every group is explicit)
 *   s_g        — direction × strength (+1 support, −1 counter)
 *   halfLife_g — 180 days for identity/address, 90 days for topics and rhythm
 *
 *   active     — score ≥ ACTIVE_THRESHOLD and at least MIN_INDEPENDENT_GROUPS
 *                distinct messages (address preferences need one explicit
 *                statement; agreed topics need two independent confirmations)
 *   candidate  — below that gate: stored, never injected
 *   expired    — nothing seen for TTL_DAYS; treated like inactive
 *   retracted  — the user withdrew it; never injected again
 *   superseded — replaced by a later, different value of the same kind
 *
 * The score is a bounded heuristic, not a probability.
 */
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'

export const RELATIONSHIP_KINDS = ['address_preference', 'shared_topic', 'shared_plan', 'rhythm_preference'] as const
export type RelationshipKind = typeof RELATIONSHIP_KINDS[number]

export const RELATIONSHIP_ACTIVE_THRESHOLD = 0.5
export const RELATIONSHIP_TTL_DAYS = 180
const HALF_LIFE_DAYS: Readonly<Record<RelationshipKind, number>> = Object.freeze({
  address_preference: 180,
  shared_plan: 90,
  shared_topic: 90,
  rhythm_preference: 90
})
/** Independent messages required before a thread may be injected. */
const MIN_GROUPS: Readonly<Record<RelationshipKind, number>> = Object.freeze({
  address_preference: 1,
  shared_plan: 1,
  shared_topic: 2,
  rhythm_preference: 1
})

export interface ThreadCandidate {
  kind: RelationshipKind
  value: string
  /** Some statements replace an earlier value of the same kind. */
  replaces?: boolean
  /** The user withdrew the thread ("那个约定就算了"). */
  retract?: boolean
}

export interface RelationshipThread {
  id: string
  kind: RelationshipKind
  value: string
  status: 'candidate' | 'active' | 'superseded' | 'retracted' | 'expired'
  strength: number
  confidence: number
  sourceMessageId: string
  superseededThreadId: string | null
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * Deterministic extraction. Only explicit, first-person statements become
 * candidates; ambiguous hints yield nothing (they may still live in the
 * conversation, which is what short-term context is for).
 */
export function extractRelationshipCandidates(text: string): ThreadCandidate[] {
  const out: ThreadCandidate[] = []
  const trimmed = text.trim()
  if (trimmed.length === 0) return out

  // Withdrawal: the user calls the thread off.
  if (/(?:那个)?约定(?:就)?算了|别提那个了|不用再提|取消(?:那个)?约定|忘了那个约定/iu.test(trimmed)) {
    out.push({ kind: 'shared_topic', value: '*', retract: true })
  }

  // Address preference: 以后叫我X / 别叫我Y / 请叫我X
  const address = /(?:以后|请|就)?(?:叫我|称我为?|喊我)([\p{Script=Han}A-Za-z0-9_\-]{1,12})/u.exec(trimmed)
  if (address && !/别再?叫我/u.test(trimmed)) {
    out.push({ kind: 'address_preference', value: address[1]!.trim(), replaces: true })
  }

  // Agreed follow-up topic: 我们下次聊X / 下次继续Y / 回头我们说Z
  const topic = /(?:我们)?(?:下次|回头|改天)(?:再)?(?:聊|说|谈|继续)([^，。！？\n]{2,20})/u.exec(trimmed)
  if (topic) out.push({ kind: 'shared_topic', value: topic[1]!.trim() })

  // Commitment: 我们说好X / 我们约好X / 你答应我X
  const plan = /(?:我们)?(?:说好|约好|讲好)([^，。！？\n]{2,24})/u.exec(trimmed)
  if (plan) out.push({ kind: 'shared_plan', value: plan[1]!.trim() })

  // Interaction rhythm: 别一次问太多 / 简单点说 / 解释别太长
  if (/(?:别|不要)(?:一次)?问太多|简单点说|说得简短|解释(?:别|不要)太长/iu.test(trimmed)) {
    out.push({ kind: 'rhythm_preference', value: 'brief', replaces: true })
  }
  return out
}

export class RelationshipThreadService {
  constructor(private readonly options: {
    database: SqliteDatabase
    clock?: (() => string) | undefined
    makeId?: (() => string) | undefined
  }) {}

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  /**
   * Records the candidates a message supports. Idempotent on
   * (thread, source message): a retried turn adds no weight twice.
   * Returns the ids that changed state.
   */
  observe(input: { text: string; messageId: string; conversationId: string; at: string }): string[] {
    const candidates = extractRelationshipCandidates(input.text)
    if (candidates.length === 0) return []
    const touched: string[] = []
    for (const candidate of candidates) {
      if (candidate.retract) {
        const active = this.rows().filter((row) => row.status === 'active' || row.status === 'candidate')
        for (const row of active) {
          this.options.database.connection.prepare(
            "UPDATE relationship_threads SET status = 'retracted', updated_at = ? WHERE id = ?"
          ).run(input.at, row.id)
          touched.push(row.id)
        }
        continue
      }
      const existing = this.rows().find((row) => row.kind === candidate.kind && row.value === candidate.value && (row.status === 'active' || row.status === 'candidate'))
      let threadId = existing?.id
      if (!threadId) {
        // A different value of a replacing kind supersedes the previous one.
        if (candidate.replaces) {
          for (const row of this.rows().filter((item) => item.kind === candidate.kind && (item.status === 'active' || item.status === 'candidate'))) {
            this.options.database.connection.prepare(
              "UPDATE relationship_threads SET status = 'superseded', updated_at = ? WHERE id = ?"
            ).run(input.at, row.id)
          }
        }
        threadId = (this.options.makeId?.() ?? randomUUID()).toLowerCase()
        this.options.database.connection.prepare(`
          INSERT INTO relationship_threads(id, kind, value, status, strength, confidence, source_message_id, conversation_id, supersedes_thread_id, first_seen_at, last_seen_at, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, 'candidate', 0, 60, ?, ?, NULL, ?, ?, NULL, ?, ?)
        `).run(threadId, candidate.kind, candidate.value.slice(0, 200), input.messageId, input.conversationId, input.at, input.at, input.at, input.at)
      }
      this.options.database.connection.prepare(`
        INSERT INTO relationship_thread_evidence(thread_id, source_message_id, conversation_id, polarity, weight, created_at)
        VALUES (?, ?, ?, 'support', 1.0, ?)
        ON CONFLICT(thread_id, source_message_id) DO NOTHING
      `).run(threadId, input.messageId, input.conversationId, input.at)
      this.recompute(threadId, input.at)
      touched.push(threadId)
    }
    return touched
  }

  /** Recomputes strength, status and expiry from the evidence ledger. */
  private recompute(threadId: string, at: string): void {
    const thread = this.options.database.connection.prepare(
      'SELECT kind, first_seen_at FROM relationship_threads WHERE id = ?'
    ).get(threadId) as { kind: RelationshipKind; first_seen_at: string } | undefined
    if (!thread) return
    const evidence = this.options.database.connection.prepare(
      'SELECT source_message_id, polarity, weight, created_at FROM relationship_thread_evidence WHERE thread_id = ?'
    ).all(threadId) as Array<{ source_message_id: string; polarity: string; weight: number; created_at: string }>
    const nowMs = Date.parse(at)
    const halfLife = HALF_LIFE_DAYS[thread.kind]
    let total = 0
    let groups = 0
    let lastSeen = thread.first_seen_at
    for (const row of evidence) {
      const ageDays = Math.max(0, (nowMs - Date.parse(row.created_at)) / 86_400_000)
      const direction = row.polarity === 'counter' ? -1 : 1
      total += direction * row.weight * Math.pow(0.5, ageDays / halfLife)
      groups += 1
      if (row.created_at > lastSeen) lastSeen = row.created_at
    }
    const strength = Math.max(0, Math.min(1, total))
    const expired = (nowMs - Date.parse(lastSeen)) / 86_400_000 > RELATIONSHIP_TTL_DAYS
    const current = this.options.database.connection.prepare(
      'SELECT status FROM relationship_threads WHERE id = ?'
    ).get(threadId) as { status: string }
    // A retracted thread stays retracted; retraction is a user decision, not a
    // score.
    if (current.status === 'retracted') return
    const status = expired
      ? 'expired'
      : strength >= RELATIONSHIP_ACTIVE_THRESHOLD && groups >= MIN_GROUPS[thread.kind]
        ? 'active'
        : 'candidate'
    this.options.database.connection.prepare(`
      UPDATE relationship_threads SET strength = ?, status = ?, confidence = ?, last_seen_at = ?, expires_at = ?, updated_at = ? WHERE id = ?
    `).run(strength, status, Math.round(60 + 40 * strength), lastSeen, expired ? lastSeen : null, at, threadId)
  }

  /**
   * Threads eligible for the current turn: active, not retracted/expired/
   * superseded, most recent first, bounded.
   */
  activeThreads(limit = 4, at = this.clock()): RelationshipThread[] {
    for (const row of this.rows()) {
      if (row.status === 'active' || row.status === 'candidate') this.recompute(row.id, at)
    }
    const rows = this.rows().filter((row) => row.status === 'active')
    return rows
      .sort((left, right) => right.strength - left.strength || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit)
  }

  private rows(): RelationshipThread[] {
    return (this.options.database.connection.prepare(
      'SELECT id, kind, value, status, strength, confidence, source_message_id, supersedes_thread_id, first_seen_at, last_seen_at FROM relationship_threads ORDER BY last_seen_at DESC'
    ).all() as Array<{ id: string; kind: string; value: string; status: string; strength: number; confidence: number; source_message_id: string; supersedes_thread_id: string | null; first_seen_at: string; last_seen_at: string }>)
      .map((row) => ({
        id: row.id,
        kind: row.kind as RelationshipKind,
        value: row.value,
        status: row.status as RelationshipThread['status'],
        strength: row.strength,
        confidence: row.confidence,
        sourceMessageId: row.source_message_id,
        superseededThreadId: row.supersedes_thread_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at
      }))
  }

  /** Explicit withdrawal, for a UI or a test. */
  retract(threadId: string): void {
    this.options.database.connection.prepare(
      "UPDATE relationship_threads SET status = 'retracted', updated_at = ? WHERE id = ?"
    ).run(this.clock(), threadId)
  }
}

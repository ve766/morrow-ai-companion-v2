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

/**
 * A relationship change, with an explicit target (Stage 5 remediation, P0-A).
 *
 * The earlier version retracted every active thread when the user said "那个
 * 约定就算了" — a global write from an ambiguous sentence. Every mutation now
 * names what it changes; when the target cannot be identified the planner
 * returns `clarify` and nothing is written.
 */
export type RelationshipMutation =
  | { type: 'support'; kind: RelationshipKind; value: string; replaces?: boolean }
  | { type: 'replace'; kind: RelationshipKind; oldThreadId: string; newValue: string }
  | { type: 'retract'; threadId: string; reason: string }
  | { type: 'retract_kind'; kind: RelationshipKind }
  | { type: 'retract_all'; explicitGlobalIntent: true }
  | { type: 'clarify'; reason: string }

export interface ThreadCandidate {
  kind: RelationshipKind
  value: string
  replaces?: boolean
}

/** The rows the planner needs to name a target; supplied by the service. */
export interface ThreadRow {
  id: string
  kind: RelationshipKind
  value: string
  status: string
}

/** Explicit statements that ask to address the user differently. */
const ADDRESS_NEW = /(?:以后|请|就)?(?:叫我|称我为?|喊我)([\p{Script=Han}A-Za-z0-9_\-]{1,12})/u
/** "别再叫我小林" — a negation of a specific old form. */
const ADDRESS_NEGATED = /(?:别再?|不要(?:再)?|不用再?)(?:这么|这样)?(?:叫我|喊我|称我为?)([\p{Script=Han}A-Za-z0-9_\-]{1,12})?/u
/** A generic rejection of the current form, with no replacement. */
const ADDRESS_REJECT = /(?:我不喜欢|别用|不要用)(?:这个|那个)?称呼|不要这样称呼我|别这么称呼我/u
/** "还是叫我之前那个名字" — refers to a value the planner cannot know. */
const ADDRESS_AMBIGUOUS = /(?:还是|就)(?:叫我)?(?:之前|原来|以前)(?:那个)?(?:名字|称呼)/u

/**
 * Turns one user message into at most one relationship change.
 *
 * Deterministic and conservative: an ambiguous target yields `clarify` and the
 * caller writes nothing.
 */
export function planRelationshipMutation(text: string, rows: readonly ThreadRow[]): RelationshipMutation | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const live = rows.filter((row) => row.status === 'active' || row.status === 'candidate')

  // 1. Explicit global intent only. The sentence has to name the set and the
  // act; "都撤回" alone would let a colloquial complaint retire everything.
  if (
    /(?:全部|所有|都)(?:撤回|取消|作废)(?:那些)?(?:约定|偏好|称呼)/u.test(trimmed) ||
    /把这些(?:约定|偏好|称呼)(?:和(?:约定|偏好|称呼))*都(?:撤回|取消|作废)/u.test(trimmed) ||
    /(?:撤回|取消|作废)(?:所有|全部)(?:的)?(?:关系)?(?:约定|偏好|称呼)/u.test(trimmed)
  ) {
    return { type: 'retract_all', explicitGlobalIntent: true }
  }

  // 2. Addressing the user.
  if (ADDRESS_AMBIGUOUS.test(trimmed)) return { type: 'clarify', reason: 'address_without_value' }
  if (ADDRESS_REJECT.test(trimmed) && !ADDRESS_NEW.test(trimmed)) {
    const current = live.filter((row) => row.kind === 'address_preference')
    if (current.length === 1) return { type: 'retract', threadId: current[0]!.id, reason: 'user_rejected_current_address' }
    return { type: 'clarify', reason: current.length > 1 ? 'multiple_address_preferences' : 'no_address_to_retract' }
  }
  const negated = ADDRESS_NEGATED.exec(trimmed)
  if (negated) {
    // "别再叫我小林，叫我阿林": the first 叫我… match sits inside the negation,
    // so the replacement is searched for only after the negated phrase. Reading
    // the first match would re-assert the very name the user rejected.
    const rest = trimmed.slice(negated.index + negated[0].length)
    const replacement = ADDRESS_NEW.exec(rest)
    const oldValue = negated[1] ?? null
    if (replacement?.[1] && replacement[1] !== oldValue) {
      const old = oldValue
        ? live.find((row) => row.kind === 'address_preference' && row.value === oldValue)
        : undefined
      if (old) return { type: 'replace', kind: 'address_preference', oldThreadId: old.id, newValue: replacement[1] }
      // The user negated a form we do not hold: take the new one, replacing any
      // other active address.
      return { type: 'support', kind: 'address_preference', value: replacement[1], replaces: true }
    }
    // Only a negation was given. Retire the named form (or the single current
    // one); never invent a replacement, and never fall back to a global write.
    const current = oldValue
      ? live.filter((row) => row.kind === 'address_preference' && row.value === oldValue)
      : live.filter((row) => row.kind === 'address_preference')
    if (current.length === 1) return { type: 'retract', threadId: current[0]!.id, reason: 'user_rejected_current_address' }
    return { type: 'clarify', reason: current.length > 1 ? 'multiple_address_preferences' : 'no_address_to_retract' }
  }
  const fresh = ADDRESS_NEW.exec(trimmed)
  if (fresh) return { type: 'support', kind: 'address_preference', value: fresh[1]!, replaces: true }

  // 3. Withdrawing an agreement ("那个约定就算了"): only a uniquely
  // identifiable agreement may be retracted; otherwise clarify.
  if (/(?:那个)?约定(?:就)?算了|别提那个了|不用再提|取消(?:那个)?约定|忘了那个约定/u.test(trimmed)) {
    const agreements = live.filter((row) => row.kind === 'shared_topic' || row.kind === 'shared_plan')
    if (agreements.length === 1) return { type: 'retract', threadId: agreements[0]!.id, reason: 'user_withdrew_agreement' }
    if (agreements.length === 0) return { type: 'clarify', reason: 'no_agreement_to_retract' }
    return { type: 'clarify', reason: 'ambiguous_agreement_target' }
  }

  // 4. New content.
  const topic = /(?:我们)?(?:下次|回头|改天)(?:再)?(?:聊|说|谈|继续)([^，。！？\n]{2,20})/u.exec(trimmed)
  if (topic) return { type: 'support', kind: 'shared_topic', value: topic[1]!.trim() }
  const plan = /(?:我们)?(?:说好|约好|讲好)([^，。！？\n]{2,24})/u.exec(trimmed)
  if (plan) return { type: 'support', kind: 'shared_plan', value: plan[1]!.trim() }
  if (/(?:别|不要)(?:一次)?问太多|简单点说|说得简短|解释(?:别|不要)太长/iu.test(trimmed)) {
    return { type: 'support', kind: 'rhythm_preference', value: 'brief', replaces: true }
  }
  return null
}

/** Kept for callers that only need the additive candidates. */
export function extractRelationshipCandidates(text: string): ThreadCandidate[] {
  const mutation = planRelationshipMutation(text, [])
  if (!mutation || mutation.type !== 'support') return []
  return [{ kind: mutation.kind, value: mutation.value, ...(mutation.replaces ? { replaces: true } : {}) }]
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

export interface ObserveResult {
  /** What was written, or why nothing was. */
  mutation: RelationshipMutation | null
  threadIds: string[]
  /** True when the caller should ask the user which target was meant. */
  clarification?: string
}

/** The journal event this service emits; no user text, only codes. */
interface RelationshipEvent {
  sourceModule: 'self-model'
  eventType: string
  actor: 'user' | 'system'
  subjectType: string
  subjectId: string
  correlationId: string | null
  payload: Record<string, unknown>
}

export class RelationshipThreadService {
  constructor(private readonly options: {
    database: SqliteDatabase
    clock?: (() => string) | undefined
    makeId?: (() => string) | undefined
    /**
     * Optional journal sink. `recordDeterministic` is preferred when present so
     * a replayed turn records one event, not two.
     */
    events?: {
      tryRecord(event: RelationshipEvent): unknown
      recordDeterministic?(key: string, event: RelationshipEvent): unknown
    } | undefined
  }) {}

  private recordEvent(key: string, event: RelationshipEvent): void {
    try {
      if (this.options.events?.recordDeterministic) this.options.events.recordDeterministic(key, event)
      else this.options.events?.tryRecord(event)
    } catch {
      // Diagnostics must not change the outcome of a user's request.
    }
  }

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  /**
   * Records what this message changes. Idempotent on (thread, source message):
   * a retried turn adds no weight twice, and a retry of a retraction is a no-op.
   *
   * Nothing is written when the target cannot be identified; the caller gets a
   * clarification reason instead, so an ambiguous "那个约定就算了" can never
   * retract an unrelated preference.
   */
  observe(input: { text: string; messageId: string; conversationId: string; at: string }): ObserveResult {
    const mutation = planRelationshipMutation(input.text, this.rows())
    if (!mutation) return { mutation: null, threadIds: [] }
    if (mutation.type === 'clarify') {
      // Observability: "asked instead of guessed" is a state a health check can
      // count. Reason code only — never the user's sentence or the values.
      this.recordEvent(`relationship-clarify:${input.messageId}`, {
        sourceModule: 'self-model',
        eventType: 'relationship.clarify',
        actor: 'system',
        subjectType: 'conversation_message',
        subjectId: input.messageId,
        correlationId: input.conversationId,
        payload: { reason: mutation.reason }
      })
      return { mutation, threadIds: [], clarification: mutation.reason }
    }

    // The caller may already hold a transaction (afterPersist runs inside the
    // message commit). database.transaction() uses a savepoint when nested, so
    // the mutation joins the turn's transaction instead of opening a second
    // BEGIN, which SQLite rejects.
    return this.options.database.transaction(() => {
      const threadIds = this.applyMutation(mutation, input)
      // The change and its cause are one durable record: which source message
      // caused it, what operation it was, and (for a withdrawal) why. Values
      // are not duplicated into the journal — the thread row is their store.
      this.recordEvent(`relationship-mutated:${input.messageId}`, {
        sourceModule: 'self-model',
        eventType: 'relationship.mutated',
        actor: 'user',
        subjectType: 'conversation_message',
        subjectId: input.messageId,
        correlationId: input.conversationId,
        payload: {
          operation: mutation.type,
          targets: threadIds.length,
          ...(mutation.type === 'retract' ? { reason: mutation.reason } : {})
        }
      })
      return { mutation, threadIds }
    })
  }

  private applyMutation(mutation: Exclude<RelationshipMutation, { type: 'clarify' }>, input: { messageId: string; conversationId: string; at: string }): string[] {
    const touched: string[] = []
    const connection = this.options.database.connection
    const live = (): RelationshipThread[] => this.rows().filter((row) => row.status === 'active' || row.status === 'candidate')
    const retract = (id: string): void => {
      connection.prepare(
        "UPDATE relationship_threads SET status = 'retracted', updated_at = ? WHERE id = ? AND status != 'retracted'"
      ).run(input.at, id)
      touched.push(id)
    }

    if (mutation.type === 'retract_all') {
      for (const row of live()) retract(row.id)
      // The explicit global intent is recorded: a later reader must be able to
      // tell "the user asked for all of it" from "we guessed".
      this.recordEvent(`relationship-retract-all:${input.messageId}`, {
        sourceModule: 'self-model',
        eventType: 'relationship.retract_all',
        actor: 'user',
        subjectType: 'conversation_message',
        subjectId: input.messageId,
        correlationId: input.conversationId,
        payload: { explicitGlobalIntent: true, retracted: touched.length }
      })
      return touched
    }
    if (mutation.type === 'retract') {
      if (live().some((item) => item.id === mutation.threadId)) retract(mutation.threadId)
      return touched
    }
    if (mutation.type === 'retract_kind') {
      for (const row of live().filter((item) => item.kind === mutation.kind)) retract(row.id)
      return touched
    }
    if (mutation.type === 'replace') {
      // A replay of an older message must not retire a newer decision: only a
      // target last seen at or before this message may be superseded.
      const old = live().find((item) => item.id === mutation.oldThreadId && item.lastSeenAt <= input.at)
      if (old) {
        connection.prepare(
          "UPDATE relationship_threads SET status = 'superseded', updated_at = ? WHERE id = ?"
        ).run(input.at, old.id)
        touched.push(old.id)
      }
      const created = this.upsertThread(mutation.kind, mutation.newValue, input, old?.id ?? null)
      this.addEvidence(created, input)
      touched.push(created)
      return touched
    }
    // support (with optional replacement of a different value of the same kind)
    if (mutation.replaces) {
      for (const row of live().filter((item) => item.kind === mutation.kind && item.value !== mutation.value && item.lastSeenAt <= input.at)) {
        connection.prepare(
          "UPDATE relationship_threads SET status = 'superseded', updated_at = ? WHERE id = ?"
        ).run(input.at, row.id)
        touched.push(row.id)
      }
    }
    const threadId = this.upsertThread(mutation.kind, mutation.value, input, null)
    this.addEvidence(threadId, input)
    touched.push(threadId)
    return touched
  }

  private upsertThread(kind: RelationshipKind, value: string, input: { messageId: string; conversationId: string; at: string }, supersedes: string | null): string {
    // Match across every status, not only live rows: a replayed turn must find
    // the row it already created instead of forking a second thread with the
    // same value.
    const existing = this.rows().find((row) => row.kind === kind && row.value === value)
    if (existing) {
      if (existing.status === 'active' || existing.status === 'candidate') return existing.id
      // A later decision already covers this value. A replay of the older
      // message sees lastSeenAt >= its own time and changes nothing; only a
      // strictly newer user statement may re-assert a retracted/superseded
      // value. Score recomputation never revives a thread by itself.
      if (existing.lastSeenAt >= input.at) return existing.id
      this.options.database.connection.prepare(
        "UPDATE relationship_threads SET status = 'candidate', updated_at = ? WHERE id = ?"
      ).run(input.at, existing.id)
      return existing.id
    }
    const id = (this.options.makeId?.() ?? randomUUID()).toLowerCase()
    this.options.database.connection.prepare(
      "INSERT INTO relationship_threads(id, kind, value, status, strength, confidence, source_message_id, conversation_id, supersedes_thread_id, first_seen_at, last_seen_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, 'candidate', 0, 60, ?, ?, ?, ?, ?, NULL, ?, ?)"
    ).run(id, kind, value.slice(0, 200), input.messageId, input.conversationId, supersedes, input.at, input.at, input.at, input.at)
    return id
  }

  private addEvidence(threadId: string, input: { messageId: string; conversationId: string; at: string }): void {
    this.options.database.connection.prepare(
      "INSERT INTO relationship_thread_evidence(thread_id, source_message_id, conversation_id, polarity, weight, created_at) VALUES (?, ?, ?, 'support', 1.0, ?) ON CONFLICT(thread_id, source_message_id) DO NOTHING"
    ).run(threadId, input.messageId, input.conversationId, input.at)
    this.recompute(threadId, input.at)
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
    // Retraction and supersession are user decisions, not scores: a recompute
    // never revives them.
    if (current.status === 'retracted' || current.status === 'superseded') return
    const status = expired
      ? 'expired'
      : strength >= RELATIONSHIP_ACTIVE_THRESHOLD && groups >= MIN_GROUPS[thread.kind]
        ? 'active'
        : 'candidate'
    this.options.database.connection.prepare(
      'UPDATE relationship_threads SET strength = ?, status = ?, confidence = ?, last_seen_at = ?, expires_at = ?, updated_at = ? WHERE id = ?'
    ).run(strength, status, Math.round(60 + 40 * strength), lastSeen, expired ? lastSeen : null, at, threadId)
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

  /**
   * Drops evidence whose source message no longer exists (P0-B). The delete
   * trigger covers normal deletion; this covers a restored backup that predates
   * the deletion, and the deletion journal replay. Idempotent.
   */
  reconcile(): number {
    const orphans = this.options.database.connection.prepare(
      'DELETE FROM relationship_thread_evidence WHERE source_message_id NOT IN (SELECT id FROM messages)'
    ).run()
    const at = this.clock()
    for (const row of this.rows()) {
      if (row.status === 'active' || row.status === 'candidate') this.recompute(row.id, at)
    }
    return Number(orphans.changes ?? 0)
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

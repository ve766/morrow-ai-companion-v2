/**
 * Companion goals (Issue §2D).
 *
 * The existing `GoalService` is a task-execution demo: one fixed intent, one
 * fixed success criterion, an approval gate and a tool run. None of that can
 * express "the user wants to finish this project by spring", and bolting it on
 * would drag the Agent-shaped model into the companion layer.
 *
 * This service holds the companionship semantics instead: four owners-free
 * fields that matter — whose goal it is, how much it matters, when it lapses,
 * and what has happened to it. Three rules keep it honest:
 *
 *   1. **Ownership is not inferred.** `owner` is set when the goal is recorded
 *      and never copied from another goal. "The user wants X" does not become
 *      "Morrow wants X".
 *   2. **Expiry is a status, not a filter.** An overdue goal becomes `expired`
 *      and stops reaching the prompt; nothing is deleted, and `resume()` brings
 *      it back with its progress history intact.
 *   3. **Progress is append-only.** Notes, steps, blockers and decisions are
 *      rows; the goal itself only carries status, priority and revision.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'
import { resolveDueAt, stripHorizon } from './goal-time'

/** Stable short digest for an idempotency key. Never reversible to the text. */
function shortHash(value: string): string {
  return createHash('sha256').update(value.normalize('NFKC')).digest('hex').slice(0, 16)
}

export const COMPANION_GOAL_OWNERS = ['user', 'shared', 'morrow'] as const
export type CompanionGoalOwner = typeof COMPANION_GOAL_OWNERS[number]

export const COMPANION_GOAL_STATUSES = ['active', 'paused', 'completed', 'cancelled', 'expired'] as const
export type CompanionGoalStatus = typeof COMPANION_GOAL_STATUSES[number]

export interface CompanionGoal {
  id: string
  title: string
  detail: string
  owner: CompanionGoalOwner
  status: CompanionGoalStatus
  priority: number
  dueAt: string | null
  sourceMessageId: string | null
  createdAt: string
  updatedAt: string
  revision: number
}

export interface GoalProgressEntry {
  id: string
  goalId: string
  kind: 'note' | 'step' | 'blocker' | 'decision'
  note: string
  createdAt: string
}

/** What the prompt layer is allowed to see; deliberately narrow. */
export interface CompanionGoalContext {
  id: string
  title: string
  owner: CompanionGoalOwner
  priority: number
  dueAt: string | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function mapGoal(row: Record<string, unknown>): CompanionGoal {
  return {
    id: String(row.id),
    title: String(row.title),
    detail: String(row.detail),
    owner: row.owner as CompanionGoalOwner,
    status: row.status as CompanionGoalStatus,
    priority: Number(row.priority),
    dueAt: row.due_at === null || row.due_at === undefined ? null : String(row.due_at),
    sourceMessageId: row.source_message_id === null || row.source_message_id === undefined ? null : String(row.source_message_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revision: Number(row.revision)
  }
}

/**
 * A stated long-term intention, not a one-off wish.
 *
 * The subject alternation lists 我们/咱们 first: a joint plan is still a
 * commitment, and reading "我们打算…" as no commitment at all would silently
 * drop every shared goal.
 */
const COMMITMENT_SOURCE = '(?:我们|咱们|我)(?:打算|计划|准备|想要|决定|希望能)|我的(?:目标|计划)是|从(?:现在|今天)开始|长期(?:目标|计划)'
const GOAL_COMMITMENT = new RegExp(COMMITMENT_SOURCE, 'u')
const COMMITMENT_AND_CLAUSE = new RegExp(`(?:${COMMITMENT_SOURCE})\\s*([^。！？.!?]{4,160})`, 'u')
/** A horizon makes the intention checkable; without one it is only a candidate. */
const GOAL_HORIZON = /(?:今年|明年|下(?:个)?月|这(?:个)?月|本(?:周|月|季度)|\d{4}\s*年|\d{1,2}\s*月|之前|以前|底前|\bby (?:the end of )?(?:next )?(?:month|year|week)\b)/iu
/** "We will…" is a joint commitment, not the user's private plan. */
const SHARED_SUBJECT = /(?:我们|咱们)/u
const SHARED_MODALITY = /(?:一起|共同|俩)/u
/** "You could look into X" is a suggestion to Morrow, not a stated goal. */
const DELEGATED = /(?:你可以|你能不能|你帮我|帮我研究|你去了解|要不你)/u
const GOAL_QUESTION = /(?:[?？]|吗\s*[。.!！]?$)/u
const GOAL_NEGATION = /(?:不打算|没打算|不准备|不想|不再|放弃|取消|算了)/u
const GOAL_QUOTED = /(?:[「『“"'][^」』”"']{2,}[」』”"']|(?:他|她|别人|朋友|同事)(?:说|讲|提到|觉得))/u
const GOAL_HYPOTHETICAL = /(?:如果|假如|要是|假设|万一|倘若)/u
const GOAL_ROLE_PLAY = /(?:假设你是|假装|扮演|角色扮演)/u
const GOAL_DISCUSSION = /(?:我觉得.{0,12}(?:想法|计划)|这个想法|讨论一下|聊聊|听说)/u

export type GoalGate =
  | 'question'
  | 'negated'
  | 'quoted'
  | 'hypothetical'
  | 'role_play'
  | 'discussion'
  | 'delegated'
  | null

/** The first context gate that fires, in the order that matters. */
export function goalGateOf(text: string): GoalGate {
  if (GOAL_ROLE_PLAY.test(text)) return 'role_play'
  if (GOAL_HYPOTHETICAL.test(text)) return 'hypothetical'
  if (GOAL_QUOTED.test(text)) return 'quoted'
  if (GOAL_QUESTION.test(text)) return 'question'
  if (GOAL_NEGATION.test(text)) return 'negated'
  if (GOAL_DISCUSSION.test(text)) return 'discussion'
  if (DELEGATED.test(text)) return 'delegated'
  return null
}

/**
 * The clause after the intention marker, with the horizon removed.
 *
 * The old version sliced the whole clause, so "我打算明年三月之前完成 Morrow 的
 * 第一阶段" produced a title that still contained the deadline. The deadline now
 * lives in `due_at`, and the title is the commitment.
 */
export function extractGoalContent(text: string): string | null {
  const match = COMMITMENT_AND_CLAUSE.exec(text)
  const raw = (match?.[1] ?? '').trim()
  if (raw.length === 0) return null
  const withoutHorizon = stripHorizon(raw)
    .replace(/^(?:在|要|把|于|从)/u, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  if (withoutHorizon.length < 4) return null
  return withoutHorizon.slice(0, 120)
}

export interface GoalReading {
  /** Whether the turn states a commitment at all. */
  intent: 'commitment' | 'none'
  owner: CompanionGoalOwner
  content: string | null
  dueAt: string | null
  dueExpression: string | null
  dueUnresolved: boolean
  confidence: number
  /** True when the user must confirm before this becomes an active goal. */
  needsConfirmation: boolean
  /** Why the turn was refused, when it was. */
  gate: GoalGate
}

/**
 * Turns one utterance into a structured reading.
 *
 * Separate from persistence on purpose: the gates, the ownership decision and
 * the date are all decided here, and `detectFromTurn` only writes what this
 * returns. That is what makes "did the gate fire?" testable without a database.
 */
export function readGoalUtterance(input: { text: string; now: string; offsetMinutes?: number }): GoalReading {
  const text = input.text.normalize('NFKC').replaceAll(/\s+/gu, ' ').trim()
  const empty: GoalReading = {
    intent: 'none', owner: 'user', content: null, dueAt: null, dueExpression: null,
    dueUnresolved: false, confidence: 0, needsConfirmation: false, gate: null
  }
  if (text.length < 4) return empty
  const gate = goalGateOf(text)
  if (gate) return { ...empty, gate }
  if (!GOAL_COMMITMENT.test(text)) return empty
  const content = extractGoalContent(text)
  if (!content) return empty
  const due = resolveDueAt(text, input.now, input.offsetMinutes)
  const owner: CompanionGoalOwner = SHARED_SUBJECT.test(text) && SHARED_MODALITY.test(text) ? 'shared' : 'user'
  // A resolved date is a checkable commitment. A missing or unparseable one is
  // not: the goal stays a candidate and the deadline question is asked, rather
  // than being silently dropped or invented.
  const confidence = due.dueAt ? 0.85 : due.unresolved ? 0.45 : 0.6
  return {
    intent: 'commitment',
    owner,
    content,
    dueAt: due.dueAt,
    dueExpression: due.expression,
    dueUnresolved: due.unresolved,
    confidence,
    needsConfirmation: due.dueAt === null,
    gate: null
  }
}

export class CompanionGoalService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  /**
   * Derives a goal from what the user actually said.
   *
   * Three outcomes, deliberately different:
   *   - an explicit commitment with a *resolved* horizon creates the goal
   *     directly, because the user stated it as their own plan and the date is
   *     checkable;
   *   - a commitment without a resolvable horizon becomes a pending candidate
   *     and keeps whatever time phrase the user used, so the clarification
   *     question can quote it;
   *   - anything gated (question, negation, quote, hypothetical, role-play,
   *     discussion, or "you could look into X") produces nothing at all.
   *
   * A goal is never derived from Morrow's own text, and a suggestion to Morrow
   * is not the user's plan: `owner` stays `user` or `shared` for both written
   * outcomes, and a delegated suggestion is refused rather than reassigned.
   */
  detectFromTurn(input: { conversationId: string; sourceMessageId: string; text: string }): { goalId: string | null; candidateId: string | null } {
    const reading = readGoalUtterance({ text: input.text, now: this.clock() })
    if (reading.intent === 'none' || !reading.content) return { goalId: null, candidateId: null }

    // Idempotent on the source message and the derived title: a retried turn, a
    // repeated drain or a crash-replay must not create a second goal.
    const idempotencyKey = `goal:turn:${input.sourceMessageId}:${shortHash(reading.content)}`
    const existingKey = this.database.connection.prepare(
      'SELECT goal_id FROM goal_creation_keys WHERE idempotency_key = ?'
    ).get(idempotencyKey) as { goal_id: string } | undefined
    if (existingKey) return { goalId: existingKey.goal_id, candidateId: null }

    if (reading.needsConfirmation === false && reading.dueAt) {
      const goal = this.create({
        title: reading.content,
        owner: reading.owner,
        priority: 2,
        dueAt: reading.dueAt,
        sourceMessageId: input.sourceMessageId,
        idempotencyKey
      })
      return { goalId: goal.id, candidateId: null }
    }

    const existing = this.database.connection.prepare(
      'SELECT id FROM goal_candidates WHERE source_message_id = ? AND title = ?'
    ).get(input.sourceMessageId, reading.content) as { id: string } | undefined
    if (existing) return { goalId: null, candidateId: existing.id }

    const candidateId = this.makeId().toLowerCase()
    const now = this.clock()
    this.database.connection.prepare(`
      INSERT INTO goal_candidates(id, conversation_id, source_message_id, title, detail, owner, status, confidence, evidence_json, created_at, updated_at, due_at, due_expression, source_state)
      VALUES (?, ?, ?, ?, '', ?, 'pending', ?, ?, ?, ?, ?, ?, 'live')
    `).run(
      candidateId, input.conversationId, input.sourceMessageId, reading.content, reading.owner,
      reading.confidence, JSON.stringify([{ kind: 'message', id: input.sourceMessageId }]),
      now, now, reading.dueAt, reading.dueExpression
    )
    return { goalId: null, candidateId }
  }

  /** Candidates awaiting confirmation, oldest first. */
  listCandidates(): Array<{ id: string; title: string; conversationId: string; createdAt: string; dueAt: string | null; dueExpression: string | null; owner: CompanionGoalOwner; sourceState: string }> {
    const rows = this.database.connection.prepare(
      "SELECT id, title, conversation_id, created_at, due_at, due_expression, owner, source_state FROM goal_candidates WHERE status = 'pending' ORDER BY created_at, id"
    ).all() as Array<{ id: string; title: string; conversation_id: string; created_at: string; due_at: string | null; due_expression: string | null; owner: string; source_state: string }>
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      dueAt: row.due_at,
      dueExpression: row.due_expression,
      owner: row.owner as CompanionGoalOwner,
      sourceState: row.source_state
    }))
  }

  /**
   * Accepts a candidate: the only path from a proposal to a stored goal.
   *
   * One transaction covers the source check, the goal creation, the candidate
   * status change and the audit event. Half of that committing would leave
   * either an acceptable candidate whose goal already exists, or an accepted
   * candidate with no goal — both of which the old read-then-write version could
   * produce under a concurrent accept.
   */
  acceptCandidate(candidateId: string): CompanionGoal {
    const id = candidateId.toLowerCase()
    return this.database.transaction(() => {
      const row = this.database.connection.prepare(
        'SELECT id, title, conversation_id, source_message_id, status, owner, due_at, source_state FROM goal_candidates WHERE id = ?'
      ).get(id) as {
        id: string; title: string; conversation_id: string; source_message_id: string
        status: string; owner: string; due_at: string | null; source_state: string
      } | undefined
      if (!row) throw new TypeError('Goal candidate not found.')

      // Accepting twice is not an error: it returns the goal the first accept
      // created. The unique key on `candidate_id` is the final defence.
      if (row.status === 'accepted') {
        const existing = this.database.connection.prepare(
          'SELECT * FROM companion_goals WHERE candidate_id = ?'
        ).get(id) as Record<string, unknown> | undefined
        if (existing) return mapGoal(existing)
        throw new TypeError('Goal candidate was accepted but its goal is missing.')
      }
      if (row.status !== 'pending') throw new TypeError('Goal candidate is not pending.')

      // A candidate whose source message is gone cannot be accepted: there is
      // nothing left to confirm.
      if (row.source_state !== 'live') {
        this.database.connection.prepare(
          "UPDATE goal_candidates SET status = 'expired', updated_at = ? WHERE id = ?"
        ).run(this.clock(), id)
        throw new TypeError('Goal candidate source is no longer available.')
      }
      const source = this.database.connection.prepare('SELECT id FROM messages WHERE id = ?').get(row.source_message_id)
      if (!source) {
        this.database.connection.prepare(
          "UPDATE goal_candidates SET status = 'expired', source_state = 'source_deleted', updated_at = ? WHERE id = ?"
        ).run(this.clock(), id)
        throw new TypeError('Goal candidate source is no longer available.')
      }

      const goal = this.createInner({
        title: row.title,
        owner: row.owner as CompanionGoalOwner,
        dueAt: row.due_at,
        sourceMessageId: row.source_message_id,
        candidateId: id,
        idempotencyKey: `goal:candidate:${id}`
      })
      this.database.connection.prepare("UPDATE goal_candidates SET status = 'accepted', updated_at = ? WHERE id = ?").run(this.clock(), id)
      return goal
    })
  }

  rejectCandidate(candidateId: string): void {
    this.database.connection.prepare("UPDATE goal_candidates SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'").run(this.clock(), candidateId)
  }

  create(input: {
    title: string
    detail?: string
    owner?: CompanionGoalOwner
    priority?: number
    dueAt?: string | null
    sourceMessageId?: string | null
    candidateId?: string | null
    idempotencyKey?: string
  }): CompanionGoal {
    // The key and the goal must commit together: a key without a goal would
    // block every retry, and a goal without a key would duplicate on retry.
    return this.database.transaction(() => this.createInner(input))
  }

  private createInner(input: {
    title: string
    detail?: string
    owner?: CompanionGoalOwner
    priority?: number
    dueAt?: string | null
    sourceMessageId?: string | null
    candidateId?: string | null
    idempotencyKey?: string
  }): CompanionGoal {
    if (input.idempotencyKey) {
      const existing = this.database.connection.prepare(
        'SELECT goal_id FROM goal_creation_keys WHERE idempotency_key = ?'
      ).get(input.idempotencyKey) as { goal_id: string } | undefined
      if (existing) {
        const goal = this.get(existing.goal_id)
        if (goal) return goal
      }
    }
    const title = input.title?.trim() ?? ''
    if (title.length === 0 || title.length > 200) throw new TypeError('A goal needs a title of 1-200 characters.')
    const owner = input.owner ?? 'user'
    if (!COMPANION_GOAL_OWNERS.includes(owner)) throw new TypeError('Unknown goal owner.')
    const priority = input.priority ?? 3
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new TypeError('Goal priority must be an integer 1-5.')
    if (input.sourceMessageId && !uuidPattern.test(input.sourceMessageId)) throw new TypeError('Goal source must be a message id.')
    if (input.dueAt !== null && input.dueAt !== undefined && !Number.isFinite(Date.parse(input.dueAt))) {
      throw new TypeError('Goal due date must be an ISO timestamp.')
    }
    const now = this.clock()
    const goal: CompanionGoal = {
      id: this.makeId().toLowerCase(),
      title,
      detail: (input.detail ?? '').slice(0, 1000),
      owner,
      status: 'active',
      priority,
      dueAt: input.dueAt ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      createdAt: now,
      updatedAt: now,
      revision: 1
    }
    this.database.connection.prepare(`
      INSERT INTO companion_goals(id, title, detail, owner, status, priority, due_at, source_message_id, created_at, updated_at, revision, candidate_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(goal.id, goal.title, goal.detail, goal.owner, goal.status, goal.priority, goal.dueAt, goal.sourceMessageId, goal.createdAt, goal.updatedAt, goal.revision, input.candidateId ?? null)
    if (input.idempotencyKey) {
      this.database.connection.prepare(
        'INSERT INTO goal_creation_keys(idempotency_key, goal_id, created_at) VALUES (?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING'
      ).run(input.idempotencyKey, goal.id, now)
    }
    return goal
  }

  get(goalId: string): CompanionGoal | null {
    const row = this.database.connection.prepare('SELECT * FROM companion_goals WHERE id = ?').get(goalId.toLowerCase())
    return row ? mapGoal(row as Record<string, unknown>) : null
  }

  list(filter: { status?: CompanionGoalStatus; owner?: CompanionGoalOwner } = {}): CompanionGoal[] {
    const clauses: string[] = []
    const values: Array<string | number> = []
    if (filter.status) { clauses.push('status = ?'); values.push(filter.status) }
    if (filter.owner) { clauses.push('owner = ?'); values.push(filter.owner) }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.database.connection.prepare(
      // Priority 1 is the most important, so the ordering is ascending; tying to
      // creation time would let a trivial new goal outrank a stated commitment.
      `SELECT * FROM companion_goals ${where} ORDER BY priority ASC, updated_at DESC, id`
    ).all(...values) as Array<Record<string, unknown>>
    return rows.map(mapGoal)
  }

  /**
   * Goals that may reach the prompt.
   *
   * Only `active` goals whose due date has not passed. Expiry is applied first
   * so a goal that lapsed between turns cannot be described as current.
   */
  activeForContext(limit = 3): CompanionGoalContext[] {
    this.expireOverdue()
    return this.list({ status: 'active' })
      // A goal whose source message was deleted can no longer be traced to what
      // the user said; the trigger cancels it, and this is the second line of
      // defence for rows written before the trigger existed.
      .filter((goal) => goal.sourceMessageId === null || this.sourceExists(goal.sourceMessageId))
      .slice(0, limit)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        owner: goal.owner,
        priority: goal.priority,
        dueAt: goal.dueAt
      }))
  }

  private sourceExists(messageId: string): boolean {
    return this.database.connection.prepare('SELECT 1 AS ok FROM messages WHERE id = ?').get(messageId) !== undefined
  }

  /** Marks every overdue active goal as expired. Returns how many changed. */
  expireOverdue(): number {
    const now = this.clock()
    const result = this.database.connection.prepare(
      "UPDATE companion_goals SET status = 'expired', updated_at = ?, revision = revision + 1 WHERE status = 'active' AND due_at IS NOT NULL AND due_at < ?"
    ).run(now, now)
    return Number(result.changes)
  }

  setStatus(goalId: string, status: CompanionGoalStatus): CompanionGoal | null {
    if (!COMPANION_GOAL_STATUSES.includes(status)) throw new TypeError('Unknown goal status.')
    const now = this.clock()
    this.database.connection.prepare(
      'UPDATE companion_goals SET status = ?, updated_at = ?, revision = revision + 1 WHERE id = ?'
    ).run(status, now, goalId.toLowerCase())
    return this.get(goalId)
  }

  complete(goalId: string): CompanionGoal | null { return this.setStatus(goalId, 'completed') }
  cancel(goalId: string): CompanionGoal | null { return this.setStatus(goalId, 'cancelled') }
  pause(goalId: string): CompanionGoal | null { return this.setStatus(goalId, 'paused') }

  /** Reopens a paused or expired goal. A cancelled one stays cancelled. */
  resume(goalId: string): CompanionGoal | null {
    const goal = this.get(goalId)
    if (!goal) return null
    if (goal.status === 'cancelled') throw new TypeError('A cancelled goal cannot be resumed.')
    return this.setStatus(goalId, 'active')
  }

  recordProgress(input: { goalId: string; kind: GoalProgressEntry['kind']; note: string }): GoalProgressEntry {
    const goal = this.get(input.goalId)
    if (!goal) throw new TypeError('Unknown goal.')
    const note = input.note?.trim() ?? ''
    if (note.length === 0 || note.length > 500) throw new TypeError('A progress note needs 1-500 characters.')
    const entry: GoalProgressEntry = {
      id: this.makeId().toLowerCase(),
      goalId: goal.id,
      kind: input.kind,
      note,
      createdAt: this.clock()
    }
    this.database.connection.prepare(
      'INSERT INTO companion_goal_progress(id, goal_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(entry.id, entry.goalId, entry.kind, entry.note, entry.createdAt)
    this.database.connection.prepare('UPDATE companion_goals SET updated_at = ? WHERE id = ?').run(entry.createdAt, goal.id)
    return entry
  }

  progress(goalId: string, limit = 20): GoalProgressEntry[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM companion_goal_progress WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(goalId.toLowerCase(), limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      goalId: String(row.goal_id),
      kind: row.kind as GoalProgressEntry['kind'],
      note: String(row.note),
      createdAt: String(row.created_at)
    }))
  }

  delete(goalId: string): void {
    this.database.connection.prepare('DELETE FROM companion_goals WHERE id = ?').run(goalId.toLowerCase())
  }
}

/**
 * One bounded line per ownership class. The three classes are never merged:
 * a user goal, an agreed plan and Morrow's own question are different claims,
 * and the model is told so.
 */
export function describeGoals(goals: readonly CompanionGoalContext[]): string {
  const user = goals.filter((goal) => goal.owner === 'user')
  const shared = goals.filter((goal) => goal.owner === 'shared')
  const morrow = goals.filter((goal) => goal.owner === 'morrow')
  const lines: string[] = []
  const render = (goal: CompanionGoalContext): string =>
    `${goal.title}（优先级 ${goal.priority}${goal.dueAt ? `，期限 ${goal.dueAt.slice(0, 10)}` : ''}）`
  if (user.length > 0) lines.push(`Goals the user stated (their plan, not yours): ${user.map(render).join('; ')}. Use them to stay coherent; do not claim them as your own ambition.`)
  if (shared.length > 0) lines.push(`Plans both sides agreed on: ${shared.map(render).join('; ')}. Treat them as joint commitments.`)
  if (morrow.length > 0) lines.push(`Questions Morrow is pursuing for herself: ${morrow.map(render).join('; ')}. They are yours and may be wrong; never present them as the user's goals.`)
  // Real newlines: this used to be a literal backslash-n, which put the text
  // "\n" into the prompt between ownership classes.
  return lines.join('\n')
}

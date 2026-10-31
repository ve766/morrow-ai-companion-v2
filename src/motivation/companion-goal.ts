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
import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from '../persistence/database'

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

/** A stated long-term intention, not a one-off wish. */
const GOAL_COMMITMENT = /(?:我(?:打算|计划|准备|想要|决定)|我的(?:目标|计划)是|从(?:现在|今天)开始|长期(?:目标|计划)|\bI (?:plan|intend|decided) to\b|\bmy goal is\b)/iu
/** A horizon makes the intention checkable; without one it is only a candidate. */
const GOAL_HORIZON = /(?:今年|明年|下(?:个)?月|这(?:个)?月|本(?:周|月|季度)|\d{4}\s*年|\d{1,2}\s*月|之前|以前|底前|\bby (?:the end of )?(?:next )?(?:month|year|week)\b)/iu
/** The clause after the intention marker, trimmed to a title-sized phrase. */
function extractGoalTitle(text: string): string | null {
  const match = /(?:我(?:打算|计划|准备|想要|决定)|我的(?:目标|计划)是|长期(?:目标|计划))\s*([^。！？.!?]{4,120})/u.exec(text)
  const raw = (match?.[1] ?? '').replace(/^(?:在|要|把)/u, '').trim()
  if (raw.length < 4) return null
  return raw.slice(0, 120)
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
   * Two outcomes, deliberately different:
   *   - an explicit commitment with a horizon ("我打算明年三月前完成 X") creates
   *     the goal directly, because the user stated it as their own plan;
   *   - anything vaguer becomes a *pending candidate* and is never presented as
   *     an agreed goal until the user confirms it.
   *
   * A goal is never derived from Morrow's own text, and never from a topic the
   * user merely mentioned: `owner` stays `user` for both outcomes.
   */
  detectFromTurn(input: { conversationId: string; sourceMessageId: string; text: string }): { goalId: string | null; candidateId: string | null } {
    const text = input.text.replace(/\s+/gu, ' ').trim()
    if (text.length < 4) return { goalId: null, candidateId: null }

    const commitment = GOAL_COMMITMENT.test(text)
    if (!commitment) return { goalId: null, candidateId: null }

    const horizon = GOAL_HORIZON.exec(text)
    const title = extractGoalTitle(text)
    if (!title) return { goalId: null, candidateId: null }

    // Explicit plan + a horizon is a stated commitment: it can be stored as the
    // user's own goal. Without a horizon it stays a candidate for confirmation.
    if (horizon) {
      const goal = this.create({
        title,
        owner: 'user',
        priority: 2,
        dueAt: null,
        sourceMessageId: input.sourceMessageId
      })
      return { goalId: goal.id, candidateId: null }
    }

    const existing = this.database.connection.prepare(
      'SELECT id FROM goal_candidates WHERE source_message_id = ? AND title = ?'
    ).get(input.sourceMessageId, title) as { id: string } | undefined
    if (existing) return { goalId: null, candidateId: existing.id }

    const candidateId = this.makeId().toLowerCase()
    const now = this.clock()
    this.database.connection.prepare(`
      INSERT INTO goal_candidates(id, conversation_id, source_message_id, title, detail, owner, status, confidence, evidence_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'user', 'pending', 0.5, ?, ?, ?)
    `).run(candidateId, input.conversationId, input.sourceMessageId, title, JSON.stringify([{ kind: 'message', id: input.sourceMessageId }]), now, now)
    return { goalId: null, candidateId }
  }

  /** Candidates awaiting confirmation, oldest first. */
  listCandidates(): Array<{ id: string; title: string; conversationId: string; createdAt: string }> {
    const rows = this.database.connection.prepare(
      "SELECT id, title, conversation_id, created_at FROM goal_candidates WHERE status = 'pending' ORDER BY created_at, id"
    ).all() as Array<{ id: string; title: string; conversation_id: string; created_at: string }>
    return rows.map((row) => ({ id: row.id, title: row.title, conversationId: row.conversation_id, createdAt: row.created_at }))
  }

  /** Accepts a candidate: the only path from a proposal to a stored goal. */
  acceptCandidate(candidateId: string): CompanionGoal {
    const row = this.database.connection.prepare(
      "SELECT id, title, conversation_id, source_message_id, status FROM goal_candidates WHERE id = ?"
    ).get(candidateId) as { id: string; title: string; conversation_id: string; source_message_id: string; status: string } | undefined
    if (!row || row.status !== 'pending') throw new TypeError('Goal candidate is not pending.')
    const goal = this.create({ title: row.title, owner: 'user', sourceMessageId: row.source_message_id })
    this.database.connection.prepare("UPDATE goal_candidates SET status = 'accepted', updated_at = ? WHERE id = ?").run(this.clock(), candidateId)
    return goal
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
  }): CompanionGoal {
    const title = input.title?.trim() ?? ''
    if (title.length === 0 || title.length > 200) throw new TypeError('A goal needs a title of 1-200 characters.')
    const owner = input.owner ?? 'user'
    if (!COMPANION_GOAL_OWNERS.includes(owner)) throw new TypeError('Unknown goal owner.')
    const priority = input.priority ?? 3
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new TypeError('Goal priority must be an integer 1-5.')
    if (input.sourceMessageId && !uuidPattern.test(input.sourceMessageId)) throw new TypeError('Goal source must be a message id.')
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
      INSERT INTO companion_goals(id, title, detail, owner, status, priority, due_at, source_message_id, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(goal.id, goal.title, goal.detail, goal.owner, goal.status, goal.priority, goal.dueAt, goal.sourceMessageId, goal.createdAt, goal.updatedAt, goal.revision)
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
    return this.list({ status: 'active' }).slice(0, limit).map((goal) => ({
      id: goal.id,
      title: goal.title,
      owner: goal.owner,
      priority: goal.priority,
      dueAt: goal.dueAt
    }))
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

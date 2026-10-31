import type { SqliteDatabase } from '../persistence/database'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'

/**
 * The part of a turn reading the projectors actually consume.
 *
 * The outbox stores only this, and never the evidence envelope: the envelope
 * carries `matchedTerms`, which are substrings of the user's message, and this
 * table must not become a second copy of user text.
 */
export type ProjectedAnalysis = Pick<
  CognitiveTurnAnalysis,
  'intent' | 'confidenceScore' | 'uncertainty' | 'strategy' | 'signals'
>

/**
 * Post-turn cognition, made durable.
 *
 * The old shape ran interest/preference/growth/self-fact/reflection directly
 * after the assistant message was committed, inside one try/catch. Two things
 * could go wrong and both did:
 *
 *   - a crash between the commit and the hooks lost that turn's evidence
 *     permanently, because a retry replays the stored messages and returns early;
 *   - one failing module aborted the rest, so a broken growth fold also cost the
 *     turn its interest and self-fact evidence.
 *
 * This table is a transactional outbox. Rows are written in the same transaction
 * as the assistant message (refs only — no user text), and consumed afterwards
 * one module at a time. `(turn_id, module, handler_version)` is the idempotency
 * key, so replaying a turn ten times produces the same state.
 */
export const COGNITIVE_MODULES = ['interest', 'preference', 'growth', 'self_fact', 'reflection', 'goal'] as const
export type CognitiveModule = (typeof COGNITIVE_MODULES)[number]

/** Bumped when a projector's semantics change; old rows keep their own version. */
export const COGNITIVE_HANDLER_VERSION = 1

/** Attempts before a row is parked as failed instead of retried forever. */
export const OUTBOX_MAX_ATTEMPTS = 5

export interface OutboxRow {
  turnId: string
  module: CognitiveModule
  handlerVersion: number
  conversationId: string
  userMessageId: string
  occurredAt: string
  analysis: ProjectedAnalysis | null
  attempts: number
}

export interface ProjectorInput {
  turnId: string
  conversationId: string
  userMessageId: string
  occurredAt: string
  analysis: ProjectedAnalysis | null
  /**
   * Reads the user's own words from the source record at projection time.
   *
   * Deliberately a function: the outbox never stores message text, so a
   * projector that needs it (growth style rules, self-fact extraction) reads it
   * from the authorised source, and a deleted message simply yields an empty
   * string instead of a stale copy.
   */
  readUserMessage: () => string
}

export interface CognitiveProjector {
  module: CognitiveModule
  version: number
  project(input: ProjectorInput): void
}

export interface DrainResult {
  done: number
  failed: number
  skipped: number
}

/**
 * The analysis is stored without `evidence.matchedTerms`: those are substrings
 * of the user's message, and the outbox is not allowed to become a second copy
 * of user text.
 */
function serializableAnalysis(analysis: CognitiveTurnAnalysis | null): string | null {
  if (!analysis) return null
  return JSON.stringify({
    intent: analysis.intent,
    confidenceScore: analysis.confidenceScore,
    uncertainty: analysis.uncertainty,
    strategy: analysis.strategy,
    signals: analysis.signals
  })
}

function parseAnalysis(text: string | null): ProjectedAnalysis | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Partial<ProjectedAnalysis>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.intent !== 'string') return null
    if (typeof parsed.confidenceScore !== 'number' || !parsed.signals || typeof parsed.signals !== 'object') return null
    return parsed as ProjectedAnalysis
  } catch {
    return null
  }
}

interface OutboxSqlRow {
  turn_id: string
  module: string
  handler_version: number
  conversation_id: string
  user_message_id: string
  occurred_at: string
  analysis_json: string | null
  status: string
  attempts: number
}

export class CognitionOutbox {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Writes one pending row per module. Must be called inside the transaction
   * that commits the assistant message: that is the whole point — either the
   * message and its cognition obligations both exist, or neither does.
   */
  enqueue(input: {
    turnId: string
    conversationId: string
    userMessageId: string
    occurredAt: string
    analysis: CognitiveTurnAnalysis | null
    modules?: readonly CognitiveModule[]
  }): void {
    const turnId = input.turnId.toLowerCase()
    const at = this.clock()
    const analysis = serializableAnalysis(input.analysis)
    const statement = this.database.connection.prepare(`
      INSERT INTO cognitive_outbox(turn_id, module, handler_version, conversation_id, user_message_id, occurred_at, analysis_json, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(turn_id, module, handler_version) DO NOTHING
    `)
    for (const module of input.modules ?? COGNITIVE_MODULES) {
      statement.run(turnId, module, COGNITIVE_HANDLER_VERSION, input.conversationId, input.userMessageId, input.occurredAt, analysis, at, at)
    }
  }

  pending(turnId?: string, limit = 100): OutboxRow[] {
    const rows = (turnId
      ? this.database.connection.prepare(
          "SELECT * FROM cognitive_outbox WHERE status = 'pending' AND turn_id = ? ORDER BY created_at, module"
        ).all(turnId.toLowerCase())
      : this.database.connection.prepare(
          "SELECT * FROM cognitive_outbox WHERE status = 'pending' ORDER BY created_at, module LIMIT ?"
        ).all(limit)) as unknown as OutboxSqlRow[]
    return rows.map((row) => ({
      turnId: row.turn_id,
      module: row.module as CognitiveModule,
      handlerVersion: row.handler_version,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
      occurredAt: row.occurred_at,
      analysis: parseAnalysis(row.analysis_json),
      attempts: row.attempts
    }))
  }

  private mark(row: OutboxRow, status: 'done' | 'failed' | 'pending', error: string | null, attempts: number): void {
    this.database.connection.prepare(`
      UPDATE cognitive_outbox
      SET status = ?, attempts = ?, last_error = ?, updated_at = ?
      WHERE turn_id = ? AND module = ? AND handler_version = ?
    `).run(status, attempts, error, this.clock(), row.turnId, row.module, row.handlerVersion)
  }

  /**
   * Consumes pending rows.
   *
   * Each module is isolated: a throw is recorded against that row only, and the
   * next module still runs. A row that keeps failing is parked as `failed` after
   * `OUTBOX_MAX_ATTEMPTS`, which is visible in `stats()` rather than retried
   * forever in the background.
   */
  drain(projectors: readonly CognitiveProjector[], options: { turnId?: string; limit?: number } = {}): DrainResult {
    const rows = this.pending(options.turnId, options.limit ?? 100)
    const result: DrainResult = { done: 0, failed: 0, skipped: 0 }
    for (const row of rows) {
      const projector = projectors.find((candidate) => candidate.module === row.module && candidate.version === row.handlerVersion)
      if (!projector) {
        result.skipped += 1
        continue
      }
      try {
        projector.project({
          turnId: row.turnId,
          conversationId: row.conversationId,
          userMessageId: row.userMessageId,
          occurredAt: row.occurredAt,
          analysis: row.analysis,
          readUserMessage: () => this.readUserMessage(row.userMessageId)
        })
        this.mark(row, 'done', null, row.attempts)
        result.done += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown'
        this.mark(row, attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending', message, attempts)
        result.failed += 1
      }
    }
    return result
  }

  /** Reads the user's own words from the source record, never from a copy. */
  private readUserMessage(messageId: string): string {
    const row = this.database.connection.prepare('SELECT body FROM messages WHERE id = ?').get(messageId) as { body?: string } | undefined
    return typeof row?.body === 'string' ? row.body : ''
  }

  stats(): { pending: number; failed: number; cancelled: number } {
    const rows = this.database.connection.prepare(
      'SELECT status, COUNT(*) AS n FROM cognitive_outbox GROUP BY status'
    ).all() as Array<{ status: string; n: number }>
    const byStatus = new Map(rows.map((row) => [row.status, Number(row.n)]))
    return {
      pending: byStatus.get('pending') ?? 0,
      failed: byStatus.get('failed') ?? 0,
      cancelled: byStatus.get('cancelled') ?? 0
    }
  }
}

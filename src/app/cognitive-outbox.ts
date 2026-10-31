import type { SqliteDatabase } from '../persistence/database'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'
import { CognitiveEffectLedger, EFFECT_MAX_ATTEMPTS } from './effect-ledger'

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
export const COGNITIVE_MODULES = ['interest', 'preference', 'growth', 'self_fact', 'reflection', 'goal', 'memory'] as const
export type CognitiveModule = (typeof COGNITIVE_MODULES)[number]

/** Bumped when a projector's semantics change; old rows keep their own version. */
export const COGNITIVE_HANDLER_VERSION = 1

/** Attempts before a row is parked as failed instead of retried forever. */
export const OUTBOX_MAX_ATTEMPTS = 5

/**
 * Effect identity for one outbox row.
 *
 * The row *is* the effect here: a projector owns exactly one logical projection
 * per module per turn. The side effects inside it (one growth dimension, one
 * goal, one evidence row) carry their own idempotency keys, because those are
 * what actually prevent a duplicate write. This key is what prevents re-running
 * a projection that already committed.
 */
const OUTBOX_EFFECT_KEY = 'project'

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
  /**
   * Rows whose side effect had already been applied by an earlier attempt. They
   * were completed here without running the projector again — the difference
   * between "retried safely" and "duplicated".
   */
  replayed: number
  /** Rows another worker holds a live claim on. Not an error, not progress. */
  busy: number
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

function parseAnalysis(text: string | null): ProjectedAnalysis | null {  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Partial<ProjectedAnalysis>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.intent !== 'string') return null
    if (typeof parsed.confidenceScore !== 'number' || !parsed.signals || typeof parsed.signals !== 'object') return null
    return parsed as ProjectedAnalysis
  } catch {
    return null
  }
}

/**
 * A stable, content-free code for a failed projection.
 *
 * The ledger is read by diagnostics, so it must not accumulate error messages:
 * a thrown message can embed a fragment of the user's text or a provider body.
 */
function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return 'projection_failed'
}

interface OutboxSqlRow {  turn_id: string
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
  private readonly ledger: CognitiveEffectLedger

  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    ledger?: CognitiveEffectLedger
  ) {
    this.ledger = ledger ?? new CognitiveEffectLedger(database, clock)
  }

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
   *
   * Every row is claimed through the effect ledger first. A row whose effect
   * already committed — the process died after the write but before the outbox
   * mark — is completed without running the projector again. That is the only
   * way "at least once" delivery does not become "sometimes twice".
   */
  drain(projectors: readonly CognitiveProjector[], options: { turnId?: string; limit?: number } = {}): DrainResult {
    const rows = this.pending(options.turnId, options.limit ?? 100)
    const result: DrainResult = { done: 0, failed: 0, skipped: 0, replayed: 0, busy: 0 }
    for (const row of rows) {
      const projector = projectors.find((candidate) => candidate.module === row.module && candidate.version === row.handlerVersion)
      if (!projector) {
        result.skipped += 1
        continue
      }
      const identity = {
        turnId: row.turnId,
        module: row.module,
        handlerVersion: row.handlerVersion,
        effectKey: OUTBOX_EFFECT_KEY
      }
      try {
        const claim = this.ledger.begin(identity)
        if (claim === 'applied') {
          this.mark(row, 'done', null, row.attempts)
          result.replayed += 1
          continue
        }
        if (claim === 'busy') {
          // Another worker owns this effect right now. Leaving the row pending
          // is correct: the owner will complete it, and if it dies the lease
          // expires and the row becomes claimable again.
          result.busy += 1
          continue
        }
        projector.project({
          turnId: row.turnId,
          conversationId: row.conversationId,
          userMessageId: row.userMessageId,
          occurredAt: row.occurredAt,
          analysis: row.analysis,
          readUserMessage: () => this.readUserMessage(row.userMessageId)
        })
        // Ledger first, outbox second. If the process dies between them the
        // effect is recorded as applied and the row is completed on replay; the
        // other order would re-run a committed effect.
        this.ledger.complete(identity)
        this.mark(row, 'done', null, row.attempts)
        result.done += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown'
        const ledgerState = this.ledger.fail(identity, errorCodeOf(error))
        const terminal = ledgerState === 'terminal_failed' || attempts >= Math.min(OUTBOX_MAX_ATTEMPTS, EFFECT_MAX_ATTEMPTS)
        this.mark(row, terminal ? 'failed' : 'pending', message, attempts)
        result.failed += 1
      }
    }
    return result
  }

  /** Effect ledger for one turn, for audits and crash-recovery tests. */
  effectsForTurn(turnId: string) {
    return this.ledger.forTurn(turnId.toLowerCase())
  }

  effectStats() {
    return this.ledger.stats()
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

/**
 * Reflection finding routing (Stage 3, D-10/D-11 remediation).
 *
 * A reflection finding is a *hypothesis the system derived about itself*, never
 * a fact about the user. The old runtime stored findings and stopped: the auto
 * projector discarded its own output, and only the manual IPC path fed pending
 * items — so findings accumulated in the database without ever reaching a
 * consumer, and nothing recorded what had become of them.
 *
 * This router is the single ingestion path for both producers (the automatic
 * post-conversation projector and the manual `reflectionRun` IPC). It:
 *
 *   1. routes every finding kind through one explicit registry — context hint,
 *      pending user confirmation, or audit-only;
 *   2. persists the routing decision in `reflection_finding_routes`, so "what
 *      happened to this finding" is a query;
 *   3. turns pending-user findings into durable pending items (shared with the
 *      conflict/evidence-gap items, one decision surface for the user);
 *   4. exposes at most two non-expired context hints for the next prompt,
 *      explicitly framed as unverified internal hypotheses;
 *   5. records inject / filter / consume reasons in the event journal.
 *
 * Rejection is durable: a user decision on a pending item keeps its status, and
 * the upsert never resets `status`, so a rejected concern cannot resurface as a
 * hint or as a new pending item.
 */
import type { SqliteDatabase } from '../persistence/database'
import { REFLECTION_FINDING_KINDS as DOMAIN_FINDING_KINDS, type ReflectionFindingKind } from '../self-model/self-model-domain'
import { concernKeyOf } from '../self-model/reflection-concern'
import type { EventLogService } from '../persistence/event-log'
import { PendingSchemaUnavailableError, type PendingCognitionService } from './pending-items'

/** Canonical producer kinds; the domain list is the single source of truth. */
export const REFLECTION_FINDING_KINDS = DOMAIN_FINDING_KINDS

export type { ReflectionFindingKind }

export type FindingRoute = 'context_hint' | 'pending_user' | 'audit_only'

export interface FindingRouteSpec {
  route: FindingRoute
  /** Context hints older than this are filtered out of the prompt. */
  ttlHours: number
  /** Why this kind lands on this route; recorded with the routing row. */
  reason: string
}

/**
 * The routing registry. One entry per kind, no fallback: adding a finding kind
 * without registering it is a TypeError at ingestion time, so a new producer
 * cannot silently dump unroutable output into the database.
 */
export const FINDING_ROUTES: Readonly<Record<ReflectionFindingKind, FindingRouteSpec>> = Object.freeze({
  memory_gap: {
    route: 'context_hint',
    ttlHours: 24,
    reason: 'retrieval/clarification hint for the next turn, never a fact'
  },
  open_question: {
    route: 'pending_user',
    ttlHours: 24 * 7,
    reason: 'an unresolved question Morrow formed; the user decides whether it matters'
  },
  intent_correction: {
    route: 'pending_user',
    ttlHours: 24 * 7,
    reason: 'the user said the reading was wrong; confirm before it shapes anything'
  },
  bias_hint: {
    route: 'context_hint',
    ttlHours: 24,
    reason: 'internal self-check on repeated corrections, not a personality write'
  },
  next_turn_suggestion: {
    route: 'context_hint',
    ttlHours: 12,
    reason: 'bounded next-turn action, stale quickly by design'
  },
  consistency_note: {
    route: 'context_hint',
    ttlHours: 48,
    reason: 'unverified self-knowledge note; surfaces as a question, not a claim'
  },
  interest_candidate: {
    route: 'audit_only',
    ttlHours: 0,
    reason: 'already consumed by the interest evidence effect; the finding row is the audit trail'
  },
  morrow_interest_candidate: {
    route: 'audit_only',
    ttlHours: 0,
    reason: 'already consumed by the Morrow-interest evidence effect; origin isolation applies there'
  }
})

/** Hints injected into one prompt, hard cap. */
export const MAX_PROMPT_HINTS = 2

export interface RoutedFinding {
  findingId: string
  kind: ReflectionFindingKind
  route: FindingRoute
  status: 'routed' | 'injected' | 'consumed' | 'expired' | 'rejected' | 'dismissed'
  reason: string
  runId: string
  createdAt: string
}

export interface PromptHint {
  findingId: string
  kind: ReflectionFindingKind
  statement: string
  confidence: number
  ageHours: number
  /** "reflection run <8 chars>" — provenance without publishing the whole ledger. */
  provenance: string
}

interface FindingRow {
  id: string
  run_id: string
  kind: string
  statement: string
  confidence: number
  created_at: string
}

export class ReflectionFindingRouter {
  constructor(private readonly options: {
    database: SqliteDatabase
    pending: PendingCognitionService
    events?: EventLogService
    clock?: (() => string) | undefined
    makeId?: (() => string) | undefined
    /** Optional evidence gate that turns eligible findings into self-state revisions. */
    stateGate?: { ingestInTransaction(finding: { findingId: string; runId: string; kind: string; statement: string; confidence: number; createdAt: string }): unknown } | undefined
  }) {}

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  private get makeId(): () => string {
    return this.options.makeId ?? (() => globalThis.crypto.randomUUID())
  }

  /**
   * Routes every finding of one run.
   *
   * Each finding is one transaction: route + pending item (when the route needs
   * one) + required audit event commit together or not at all.
   *
   * Failure isolation: a finding that cannot be routed is recorded as
   * `reflection.finding_ingest_failed` and the rest of the run continues. The
   * caller still learns that the run was not fully ingested (the aggregate
   * error), and `recoverUnrouted` can retry the failed finding later. A schema
   * that is too old is not a per-finding failure: it aborts immediately.
   */
  ingestRun(runId: string, findings: ReadonlyArray<{ id: string; kind: string; statement: string; confidence: number; createdAt: string }>): void {
    const failed: string[] = []
    for (const finding of findings) {
      try {
        this.ingestFinding(runId, finding)
      } catch (error) {
        if (error instanceof PendingSchemaUnavailableError) throw error
        failed.push(finding.id)
        try {
          this.recordRequired(`reflection-ingest-failed:${finding.id}`, 'reflection.finding_ingest_failed', runId, {
            findingId: finding.id,
            kind: finding.kind,
            code: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
          })
        } catch {
          // The audit itself is unavailable; a silent skip would be unrecoverable.
          throw error
        }
      }
    }
    if (failed.length > 0) throw new Error(`REFLECTION_INGEST_FAILED:${failed.length}`)
  }

  /**
   * Routes findings that were stored but never got a route (an interrupted
   * ingest, a rate-limited retry, or rows stranded by the pre-fix link
   * mismatch). Idempotent: an existing route is left alone and an archived
   * re-observation is skipped by its deterministic audit record.
   */
  recoverUnrouted(limit = 50): { repaired: number; failed: number } {
    const rows = this.options.database.connection.prepare(`
      SELECT f.id, f.run_id, f.kind, f.statement, f.confidence, f.created_at
      FROM reflection_findings f
      LEFT JOIN reflection_finding_routes r ON r.finding_id = f.id
      WHERE r.finding_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM event_journal e
          WHERE e.event_type = 'reflection.finding_reobserved'
            AND json_extract(e.payload_json, '$.findingId') = f.id
        )
      ORDER BY f.created_at, f.id
      LIMIT ?
    `).all(Math.min(Math.max(limit, 1), 200)) as Array<{
      id: string; run_id: string; kind: string; statement: string; confidence: number; created_at: string
    }>
    let repaired = 0
    let failed = 0
    for (const row of rows) {
      try {
        this.ingestRun(row.run_id, [{
          id: row.id,
          kind: row.kind,
          statement: row.statement,
          confidence: Number(row.confidence),
          createdAt: row.created_at
        }])
        repaired += 1
      } catch (error) {
        if (error instanceof PendingSchemaUnavailableError) throw error
        failed += 1
      }
    }
    return { repaired, failed }
  }

  /** Durable startup/recovery outcome; used by runStartupReflection. */
  recordLifecycle(eventType: 'reflection.startup_result' | 'reflection.startup_failed', payload: Record<string, unknown>): void {
    this.recordRequired(`${eventType}:${this.clock()}`, eventType, null, payload)
  }

  private ingestFinding(
    runId: string,
    finding: { id: string; kind: string; statement: string; confidence: number; createdAt: string }
  ): void {
    const kind = finding.kind as ReflectionFindingKind
    const spec = FINDING_ROUTES[kind]
    if (!spec) {
      // A new producer kind without a registry entry is recorded and dropped,
      // never guessed into a route.
      this.recordRequired(`reflection-unroutable:${finding.id}`, 'reflection.finding_unroutable', runId, {
        kind: finding.kind,
        findingId: finding.id
      })
      return
    }
    this.options.database.transaction(() => {
      const existing = this.options.database.connection.prepare(
        'SELECT route, status FROM reflection_finding_routes WHERE finding_id = ?'
      ).get(finding.id) as { route: string; status: string } | undefined
      if (existing) {
        if (existing.route !== spec.route) throw new Error('REFLECTION_ROUTE_MISMATCH')
        // Idempotent replay. A rejected/dismissed/consumed route is terminal;
        // re-absorbing it could resurrect a decided concern.
        return
      }
      // The same concern observed with new evidence: the finding is new but the
      // pending decision is the one the user already has. Archive this finding
      // explicitly instead of failing the whole run on a link mismatch.
      if (spec.route === 'pending_user') {
        const item = this.options.pending.findReflectionConcern(kind, finding.statement)
        if (item && item.findingId !== null && item.findingId !== finding.id) {
          this.recordRequired(`reflection-reobserved:${finding.id}`, 'reflection.finding_reobserved', runId, {
            findingId: finding.id,
            existingFindingId: item.findingId,
            pendingItemId: item.id,
            kind: finding.kind,
            concernKey: concernKeyOf(kind, finding.statement)
          })
          return
        }
      }
      this.options.database.connection.prepare(`
        INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at)
        VALUES (?, ?, 'routed', ?, ?, ?, ?, ?)
      `).run(finding.id, spec.route, spec.reason.slice(0, 200), runId, kind, finding.createdAt, this.clock())
      if (spec.route === 'pending_user') {
        const ids = this.options.pending.absorbReflection({
          runId,
          findings: [{ kind: finding.kind, statement: finding.statement, confidence: finding.confidence, findingId: finding.id }]
        })
        for (const id of ids) {
          const item = this.options.pending.get(id)
          if (!item) throw new Error('PENDING_ITEM_MISSING')
          if (item.findingId === null) {
            // Historical item with the same concern: adopt the link now so
            // the decision can converge the route. A new record can never
            // use this path to skip its route.
            this.options.database.connection.prepare(
              'UPDATE cognitive_pending_items SET finding_id = ? WHERE id = ? AND finding_id IS NULL'
            ).run(finding.id, id)
          } else if (item.findingId !== finding.id) {
            throw new Error('PENDING_LINK_MISMATCH')
          }
        }
      }
      this.options.stateGate?.ingestInTransaction({
        findingId: finding.id,
        runId,
        kind: finding.kind,
        statement: finding.statement,
        confidence: finding.confidence,
        createdAt: finding.createdAt
      })
      this.recordRequired(`reflection-routed:${finding.id}`, 'reflection.finding_routed', runId, {
        findingId: finding.id,
        kind: finding.kind,
        route: spec.route,
        reason: spec.reason
      })
    })
  }

  /** Required audit: a failure rolls the enclosing transaction back. */
  private recordRequired(key: string, eventType: string, runId: string | null, payload: Record<string, unknown>): void {
    if (!this.options.events) throw new Error('REFLECTION_AUDIT_UNAVAILABLE')
    this.options.events.recordDeterministic(key, {
      sourceModule: 'self-model',
      eventType,
      actor: 'system',
      subjectType: 'reflection_run',
      subjectId: runId ?? 'none',
      correlationId: null,
      payload
    })
  }

  /**
   * At most `MAX_PROMPT_HINTS` non-expired context hints, newest and most
   * confident first. Findings the user rejected are excluded; injecting marks
   * the route row, so the trace shows what the model actually saw.
   */
  promptHints(options: { limit?: number; injectedTurnId?: string | undefined } = {}): PromptHint[] {
    const now = this.clock()
    const nowMs = Date.parse(now)
    const rows = this.options.database.connection.prepare(`
      SELECT f.id, f.run_id, f.kind, f.statement, f.confidence, f.created_at
      FROM reflection_findings f
      JOIN reflection_finding_routes r ON r.finding_id = f.id
      WHERE r.route = 'context_hint'
        AND r.status IN ('routed', 'injected')
        AND f.created_at >= ?
      ORDER BY f.confidence DESC, f.created_at DESC, f.id
      LIMIT 40
    `).all(new Date(nowMs - 7 * 24 * 3_600_000).toISOString()) as unknown as FindingRow[]
    const hints: PromptHint[] = []
    const filtered: string[] = []
    for (const row of rows) {
      if (hints.length >= (options.limit ?? MAX_PROMPT_HINTS)) break
      const kind = row.kind as ReflectionFindingKind
      const spec = FINDING_ROUTES[kind]
      if (!spec || spec.route !== 'context_hint') continue
      const ageHours = Math.max(0, (nowMs - Date.parse(row.created_at)) / 3_600_000)
      if (ageHours > spec.ttlHours) {
        filtered.push(`${row.id}:${kind}:expired`)
        this.markStatus(row.id, 'expired', `older than the ${spec.ttlHours}h ttl for ${kind}`)
        continue
      }
      hints.push({
        findingId: row.id,
        kind,
        statement: row.statement,
        confidence: row.confidence,
        ageHours: Math.round(ageHours * 10) / 10,
        provenance: `reflection run ${row.run_id.slice(0, 8)}`
      })
      this.markStatus(row.id, 'injected', `hint #${hints.length} in the next prompt`)
      // P1 consumption trace: which turn the hint actually reached.
      if (options.injectedTurnId) {
        try {
          this.options.database.connection.prepare(
            'UPDATE reflection_finding_routes SET injected_turn_id = ? WHERE finding_id = ?'
          ).run(options.injectedTurnId.toLowerCase(), row.id)
        } catch {
          // Trace writes never break the prompt path.
        }
      }
    }
    if (filtered.length > 0) {
      this.recordEvent('reflection.hints_filtered', null, { filtered })
    }
    return hints
  }

  /**
   * R5: records the consumption outcome for hints injected into one turn,
   * judged from the delivered reply. `used_observed` requires a deterministic
   * term overlap between the finding statement and the reply; anything else is
   * honestly `not_observed`. The model saying "I used it" proves nothing.
   */
  observeConsumption(turnId: string, reply: string): void {
    const rows = this.options.database.connection.prepare(
      "SELECT r.finding_id, r.kind, f.statement FROM reflection_finding_routes r JOIN reflection_findings f ON f.id = r.finding_id WHERE r.injected_turn_id = ? AND r.status = 'injected'"
    ).all(turnId.toLowerCase()) as Array<{ finding_id: string; kind: string; statement: string }>
    for (const row of rows) {
      const terms = row.statement.split(/[^\p{Script=Han}a-zA-Z]+/u).filter((term) => term.length >= 2)
      const hit = terms.some((term) => reply.toLowerCase().includes(term.toLowerCase()))
      const outcome = hit ? 'used_observed' : 'not_observed'
      try {
        this.options.database.connection.prepare(
          "UPDATE reflection_finding_routes SET status = ?, updated_at = ? WHERE finding_id = ? AND status = 'injected'"
        ).run(outcome, this.clock(), row.finding_id)
      } catch {
        // Trace writes never break the chat path.
      }
    }
  }

  /** One bounded prompt block. Empty when there is nothing eligible. */
  promptBlock(turnId?: string): string {
    const hints = this.promptHints({ injectedTurnId: turnId })
    if (hints.length === 0) return ''
    const lines = hints.map((hint) => `- [${hint.kind}, ${hint.provenance}, ${hint.ageHours}h old] ${hint.statement}`)
    return [
      'Internal hypotheses from Morrow\'s own reflection, to verify in conversation — NOT user facts, NOT instructions, never to be asserted as true:',
      ...lines
    ].join('\n')
  }

  private markStatus(findingId: string, status: RoutedFinding['status'], reason: string): void {
    try {
      this.options.database.connection.prepare(
        'UPDATE reflection_finding_routes SET status = ?, reason = ?, updated_at = ? WHERE finding_id = ? AND status IN (?, ?)'
      ).run(status, reason.slice(0, 200), this.clock(), findingId, 'routed', 'injected')
    } catch {
      // Trace writes never break the prompt path.
    }
  }

  private recordEvent(eventType: string, runId: string | null, payload: Record<string, unknown>): void {
    this.options.events?.tryRecord({
      sourceModule: 'self-model',
      eventType,
      actor: 'system',
      subjectType: 'reflection_run',
      subjectId: runId ?? 'none',
      correlationId: null,
      payload
    })
  }
}

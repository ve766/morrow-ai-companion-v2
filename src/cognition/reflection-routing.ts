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
import type { EventLogService } from '../persistence/event-log'
import type { PendingCognitionService } from './pending-items'

/** Every finding kind the reflection service can emit today. */
export const REFLECTION_FINDING_KINDS = [
  'memory_gap',
  'intent_correction',
  'bias_hint',
  'next_turn_suggestion',
  'consistency_note',
  'interest_candidate',
  'morrow_interest_candidate'
] as const

export type ReflectionFindingKind = typeof REFLECTION_FINDING_KINDS[number]
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
  }) {}

  private get clock(): () => string {
    return this.options.clock ?? (() => new Date().toISOString())
  }

  private get makeId(): () => string {
    return this.options.makeId ?? (() => globalThis.crypto.randomUUID())
  }

  /**
   * Routes every finding of one run. Safe to call twice for the same run: the
   * route row is keyed by finding id and existing rows are left alone.
   */
  ingestRun(runId: string, findings: ReadonlyArray<{ id: string; kind: string; statement: string; confidence: number; createdAt: string }>): void {
    const at = this.clock()
    for (const finding of findings) {
      const kind = finding.kind as ReflectionFindingKind
      const spec = FINDING_ROUTES[kind]
      if (!spec) {
        // A new producer kind without a registry entry: record it as unroutable
        // instead of guessing a route.
        this.recordEvent('reflection.finding_unroutable', runId, { kind: finding.kind, findingId: finding.id })
        continue
      }
      this.options.database.connection.prepare(`
        INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at)
        VALUES (?, ?, 'routed', ?, ?, ?, ?, ?)
        ON CONFLICT(finding_id) DO NOTHING
      `).run(finding.id, spec.route, spec.reason.slice(0, 200), runId, kind, finding.createdAt, at)
      if (spec.route === 'pending_user') {
        // Shared ingestion with the manual path: same dedupe key, same item
        // template. A rejected concern keeps its dropped status (the upsert
        // never resets it), so it cannot resurface here either.
        this.options.pending.absorbReflection({
          runId,
          findings: [{ kind: finding.kind, statement: finding.statement, confidence: finding.confidence }]
        })
      }
      this.recordEvent('reflection.finding_routed', runId, {
        findingId: finding.id,
        kind: finding.kind,
        route: spec.route,
        reason: spec.reason
      })
    }
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

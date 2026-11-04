/**
 * Persistence for Phase 2.4's two new records.
 *
 * Both writes are idempotent by construction, because the turn path can be
 * retried (a re-sent request, a recovery pass after a partial failure) and a
 * retry must never create a second row or resurrect a finished item.
 */
import type { SqliteDatabase } from './database'
import type { CognitiveTurnContext } from '../cognition/turn-context'
import type { PendingAuditSink, PendingDecision, PendingDecisionResult, PendingItem, PendingItemDraft, PendingItemStatus } from '../cognition/pending-items'
import { PendingSchemaUnavailableError } from '../cognition/pending-items'
import { concernDigestOf, legacyConcernDigestOf } from '../self-model/reflection-concern'
import { isCognitiveTurnContext, normalizeTurnContext } from '../cognition/turn-context'
export interface TurnContextPort {
  /** Insert, or replace a record that did not reach a successful outcome. */
  upsert(context: CognitiveTurnContext): void
  get(turnId: string): CognitiveTurnContext | null
  listByConversation(conversationId: string, limit: number): CognitiveTurnContext[]
}

export interface PendingItemPort {
  /** Insert a new item, or refresh the existing one with the same dedupe key. */
  upsert(draft: PendingItemDraft): PendingItem
  get(id: string): PendingItem | null
  list(options?: { status?: PendingItemStatus; limit?: number }): PendingItem[]
  decide(id: string, decision: PendingDecision, at: string): PendingDecisionResult
  resolveSystem(id: string, reason: string, at: string): PendingDecisionResult
  findByDedupeKey(dedupeKey: string): PendingItem | null
}

export class SqliteTurnContextRepository implements TurnContextPort {
  constructor(private readonly database: SqliteDatabase) {}

  upsert(context: CognitiveTurnContext): void {
    // A turn that already succeeded is final: a later recovery pass must not
    // rewrite a completed record with a weaker status.
    this.database.connection.prepare(`
      INSERT INTO cognitive_turn_contexts(turn_id, conversation_id, status, recorded_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        status = excluded.status,
        recorded_at = excluded.recorded_at,
        payload_json = excluded.payload_json
      -- Forbid a downgrade, not an update. The previous condition was
      -- status <> 'succeeded', which also blocked the same turn's own
      -- finalization patch: the context is first written as succeeded, so the
      -- patch that fills in feeling.applied and the committed state was
      -- silently dropped and every successful turn kept a pre-commit value.
      WHERE cognitive_turn_contexts.status <> 'succeeded' OR excluded.status = 'succeeded'
    `).run(
      context.turnId,
      context.conversationId,
      context.status,
      context.recordedAt,
      JSON.stringify(context)
    )
  }

  get(turnId: string): CognitiveTurnContext | null {
    const row = this.database.connection.prepare(
      'SELECT payload_json FROM cognitive_turn_contexts WHERE turn_id = ?'
    ).get(turnId.toLowerCase()) as { payload_json: string } | undefined
    if (!row) return null
    try {
      const parsed: unknown = JSON.parse(row.payload_json)
      return normalizeTurnContext(parsed)
    } catch {
      return null
    }
  }

  listByConversation(conversationId: string, limit: number): CognitiveTurnContext[] {
    const rows = this.database.connection.prepare(`
      SELECT payload_json FROM cognitive_turn_contexts
      WHERE conversation_id = ? ORDER BY recorded_at DESC, turn_id LIMIT ?
    `).all(conversationId.toLowerCase(), Math.max(1, limit)) as unknown as Array<{ payload_json: string }>
    const contexts: CognitiveTurnContext[] = []
    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(row.payload_json)
        const context = normalizeTurnContext(parsed)
        if (context) contexts.push(context)
      } catch {
        continue
      }
    }
    return contexts
  }
}

interface PendingRow {
  id: string
  dedupe_key: string
  source: string
  kind: string
  summary: string
  priority: number
  status: string
  finding_id: string | null
  decision: string | null
  conversation_id: string | null
  detail_json: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

function mapPending(row: PendingRow): PendingItem {
  let detail: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(row.detail_json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>
  } catch {
    detail = {}
  }
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    source: row.source as PendingItem['source'],
    kind: row.kind,
    summary: row.summary,
    priority: row.priority,
    status: row.status as PendingItemStatus,
    findingId: row.finding_id ?? null,
    decision: (row.decision as PendingItem['decision']) ?? null,
    conversationId: row.conversation_id,
    detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}

export class SqlitePendingItemRepository implements PendingItemPort {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly events: PendingAuditSink
  ) {}

  /** v48 added the columns the Stage 4 writes need. */
  private assertStage4Writable(): void {
    if (this.database.schemaVersion < 48) throw new PendingSchemaUnavailableError()
  }

  upsert(draft: PendingItemDraft): PendingItem {
    this.assertStage4Writable()
    // A finished item stays finished: re-observing the same concern must not
    // reopen it, otherwise a resolved conflict would reappear every turn.
    this.database.connection.prepare(`
      INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        priority = CASE WHEN cognitive_pending_items.status = 'done'
          THEN cognitive_pending_items.priority
          ELSE MAX(cognitive_pending_items.priority, excluded.priority) END,
        summary = CASE WHEN cognitive_pending_items.status = 'done'
          THEN cognitive_pending_items.summary
          ELSE excluded.summary END,
        detail_json = CASE WHEN cognitive_pending_items.status = 'done'
          THEN cognitive_pending_items.detail_json
          ELSE excluded.detail_json END
    `).run(
      draft.id,
      draft.dedupeKey,
      draft.source,
      draft.kind,
      draft.summary,
      draft.priority,
      draft.findingId ?? null,
      draft.conversationId,
      JSON.stringify(draft.detail),
      draft.createdAt,
      draft.createdAt
    )
    const stored = this.findByDedupeKey(draft.dedupeKey)
    if (!stored) throw new Error('Pending item could not be read back.')
    return stored
  }

  get(id: string): PendingItem | null {
    const row = this.database.connection.prepare('SELECT * FROM cognitive_pending_items WHERE id = ?').get(id) as unknown as PendingRow | undefined
    return row ? mapPending(row) : null
  }

  findByDedupeKey(dedupeKey: string): PendingItem | null {
    const row = this.database.connection.prepare('SELECT * FROM cognitive_pending_items WHERE dedupe_key = ?').get(dedupeKey) as unknown as PendingRow | undefined
    return row ? mapPending(row) : null
  }

  list(options: { status?: PendingItemStatus; limit?: number } = {}): PendingItem[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const rows = (options.status
      ? this.database.connection.prepare(
          'SELECT * FROM cognitive_pending_items WHERE status = ? ORDER BY priority DESC, created_at, id LIMIT ?'
        ).all(options.status, limit)
      : this.database.connection.prepare(
          'SELECT * FROM cognitive_pending_items ORDER BY priority DESC, created_at, id LIMIT ?'
        ).all(limit)) as unknown as PendingRow[]
    return rows.map(mapPending)
  }

  /**
   * BL-02: one transaction updates the item, its reflection route terminal
   * state and the audit event. A same-decision replay is unchanged; the
   * opposite decision after a terminal state is a conflict, never a silent
   * overwrite.
   *
   * New items carry finding_id and MUST have a mutable route: a missing or
   * already-terminal route fails the transaction (item and audit roll back).
   *
   * Legacy items (finding_id NULL, written before v48) are resolved by concern:
   * the item's stored statement digest is matched against the findings behind
   * mutable routes. A unique/complete match converges those routes; no match is
   * recorded honestly as `routeResolution: 'unresolved'` with
   * `routeStatus: null` instead of pretending a route was consumed. Nothing is
   * guessed from an ambiguous statement.
   */
  decide(id: string, decision: PendingDecision, at: string): PendingDecisionResult {
    const audit = this.events?.recordDeterministic?.bind(this.events)
    if (!audit) throw new Error('PENDING_AUDIT_UNAVAILABLE')
    this.assertStage4Writable()
    return this.database.transaction(() => {
      const item = this.get(id)
      if (!item) return { status: 'not_found' as const }
      const itemStatus = decision === 'accepted' ? 'done' as const : 'dropped' as const
      if (item.status !== 'open') {
        if (item.decision === decision) return { status: 'unchanged' as const, decision }
        return { status: 'conflict' as const, current: item.decision }
      }

      const routeStatus: 'consumed' | 'rejected' | 'dismissed' =
        decision === 'accepted' ? 'consumed' : decision === 'rejected' ? 'rejected' : 'dismissed'
      if (item.findingId) {
        const route = this.database.connection.prepare(
          'SELECT status FROM reflection_finding_routes WHERE finding_id = ?'
        ).get(item.findingId) as { status: string } | undefined
        if (!route) throw new Error('PENDING_ROUTE_MISSING')
        if (!['routed', 'injected', 'used_observed', 'not_observed'].includes(route.status)) {
          throw new Error('PENDING_ROUTE_STATE_CONFLICT')
        }
      }

      const updated = this.database.connection.prepare(
        "UPDATE cognitive_pending_items SET status = ?, decision = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'"
      ).run(itemStatus, decision, at, at, id)
      if (updated.changes !== 1) {
        const current = this.get(id)
        if (current?.decision === decision) return { status: 'unchanged' as const, decision }
        return { status: 'conflict' as const, current: current?.decision ?? null }
      }

      let routesUpdated = 0
      let routeResolution: 'linked' | 'linked_with_siblings' | 'resolved_by_concern' | 'unresolved' = 'unresolved'
      if (item.findingId) {
        const routeUpdated = this.database.connection.prepare(
          "UPDATE reflection_finding_routes SET status = ?, reason = ?, updated_at = ? WHERE finding_id = ? AND status IN ('routed', 'injected', 'used_observed', 'not_observed')"
        ).run(routeStatus, `user decision: ${decision}`.slice(0, 200), at, item.findingId)
        if (Number(routeUpdated.changes) !== 1) throw new Error('PENDING_ROUTE_UPDATE_FAILED')
        routesUpdated = 1
        routeResolution = 'linked'
      }
      // A legacy item adopted by a post-upgrade re-observation points at the
      // newest finding, while the original finding's route still exists. Both
      // routes describe the same concern and must reach the same terminal
      // state; the audit records how many were converged.
      const siblings = this.resolveLegacyRoutes(item, routeStatus, decision, at)
      if (siblings.matched > 0) {
        if (siblings.updated !== siblings.matched) throw new Error('PENDING_ROUTE_UPDATE_FAILED')
        routesUpdated += siblings.updated
        if (siblings.updated > 0) {
          routeResolution = item.findingId ? 'linked_with_siblings' : 'resolved_by_concern'
        }
      }

      // The audit event is inside the same transaction: a failure rolls back
      // the item and the route with it. Payload carries ids and states only.
      // `routeStatus` is null when no route could be proven; the event must not
      // claim a convergence that did not happen.
      audit(`pending-decision:${id}:${decision}`, {
        sourceModule: 'cognition',
        eventType: 'pending.decision',
        actor: 'user',
        subjectType: 'pending_item',
        subjectId: id,
        correlationId: item.findingId,
        payload: {
          decision,
          itemStatus,
          routeStatus: routesUpdated > 0 ? routeStatus : null,
          routeResolution,
          routesUpdated,
          source: item.source
        }
      })
      return { status: 'decided' as const, decision, itemStatus }
    })
  }

  /**
   * System-driven closure of an open item (the user withdrew the request that
   * created it). This is still a decision, not a status edit: it writes
   * `decision='dismissed'`, converges the same concern's routes and records
   * `pending.system_dismissed` with actor `system`. No caller may close an item
   * without this transaction.
   */
  resolveSystem(id: string, reason: string, at: string): PendingDecisionResult {
    const audit = this.events?.recordDeterministic?.bind(this.events)
    if (!audit) throw new Error('PENDING_AUDIT_UNAVAILABLE')
    this.assertStage4Writable()
    return this.database.transaction(() => {
      const item = this.get(id)
      if (!item) return { status: 'not_found' as const }
      if (item.status !== 'open') {
        if (item.decision === 'dismissed') return { status: 'unchanged' as const, decision: 'dismissed' as const }
        return { status: 'conflict' as const, current: item.decision }
      }
      if (item.findingId) {
        const route = this.database.connection.prepare(
          'SELECT status FROM reflection_finding_routes WHERE finding_id = ?'
        ).get(item.findingId) as { status: string } | undefined
        if (!route) throw new Error('PENDING_ROUTE_MISSING')
        if (!['routed', 'injected', 'used_observed', 'not_observed'].includes(route.status)) {
          throw new Error('PENDING_ROUTE_STATE_CONFLICT')
        }
      }

      const updated = this.database.connection.prepare(
        "UPDATE cognitive_pending_items SET status = 'dropped', decision = 'dismissed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'"
      ).run(at, at, id)
      if (updated.changes !== 1) throw new Error('PENDING_DECISION_CONFLICT')

      let routesUpdated = 0
      let routeResolution: 'linked' | 'linked_with_siblings' | 'resolved_by_concern' | 'unresolved' = 'unresolved'
      if (item.findingId) {
        const routeUpdated = this.database.connection.prepare(
          "UPDATE reflection_finding_routes SET status = 'dismissed', reason = ?, updated_at = ? WHERE finding_id = ? AND status IN ('routed', 'injected', 'used_observed', 'not_observed')"
        ).run(`system decision: ${reason}`.slice(0, 200), at, item.findingId)
        if (Number(routeUpdated.changes) !== 1) throw new Error('PENDING_ROUTE_UPDATE_FAILED')
        routesUpdated = 1
        routeResolution = 'linked'
      }
      const siblings = this.resolveLegacyRoutes(item, 'dismissed', 'dismissed', at)
      if (siblings.matched > 0) {
        if (siblings.updated !== siblings.matched) throw new Error('PENDING_ROUTE_UPDATE_FAILED')
        routesUpdated += siblings.updated
        if (siblings.updated > 0) {
          routeResolution = item.findingId ? 'linked_with_siblings' : 'resolved_by_concern'
        }
      }

      audit(`pending-system-dismissed:${id}`, {
        sourceModule: 'cognition',
        eventType: 'pending.system_dismissed',
        actor: 'system',
        subjectType: 'pending_item',
        subjectId: id,
        correlationId: item.findingId,
        payload: {
          decision: 'dismissed',
          itemStatus: 'dropped',
          reason: reason.slice(0, 120),
          routeStatus: routesUpdated > 0 ? 'dismissed' : null,
          routeResolution,
          routesUpdated,
          source: item.source
        }
      })
      return { status: 'decided' as const, decision: 'dismissed' as const, itemStatus: 'dropped' as const }
    })
  }

  /**
   * Resolves the routes of a pre-v48 item from the concern it stored.
   *
   * The item key is `reflection:<kind>:<16-hex digest>`; the digest is matched
   * against the statement behind each mutable route. Multiple matches are all
   * the same concern (same statement) and are all converged; zero matches stay
   * untouched and are reported as unresolved. A key that is not a reflection
   * key is never guessed.
   */
  private resolveLegacyRoutes(
    item: PendingItem,
    routeStatus: 'consumed' | 'rejected' | 'dismissed',
    decision: PendingDecision,
    at: string
  ): { matched: number; updated: number } {
    const parsed = /^reflection:(.+):([0-9a-f]{16})$/u.exec(item.dedupeKey)
    if (!parsed) return { matched: 0, updated: 0 }
    const kind = parsed[1]!
    const digest = parsed[2]!
    const rows = this.database.connection.prepare(`
      SELECT r.finding_id, f.statement
      FROM reflection_finding_routes r
      JOIN reflection_findings f ON f.id = r.finding_id
      WHERE f.kind = ?
        AND r.status IN ('routed', 'injected', 'used_observed', 'not_observed')
      ORDER BY r.finding_id
    `).all(kind) as Array<{ finding_id: string; statement: string }>
    const matches = rows.filter((row) =>
      concernDigestOf(row.statement) === digest || legacyConcernDigestOf(row.statement) === digest
    )
    let updated = 0
    for (const row of matches) {
      const result = this.database.connection.prepare(
        "UPDATE reflection_finding_routes SET status = ?, reason = ?, updated_at = ? WHERE finding_id = ? AND status IN ('routed', 'injected', 'used_observed', 'not_observed')"
      ).run(routeStatus, `user decision: ${decision}`.slice(0, 200), at, row.finding_id)
      updated += Number(result.changes)
    }
    return { matched: matches.length, updated }
  }
}

/**
 * Finalization intent, Phase 2.4 remediation.
 *
 * The assistant message is the commit point of a turn, but the turn context
 * and the pending items are derived data that can fail to write. Rather than
 * writing them after the fact and hoping, the turn records *what it intends to
 * finalize* before the message is committed. If the process dies, the intent
 * is the persisted evidence recovery works from — it is never a guess.
 */
export interface TurnFinalizationRecord {
  turnId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  /** The state event this turn proposed, if any; used to verify it landed. */
  feelingEventId: string | null
  /** The context template; `updates.pendingItemIds` is filled at finalize time. */
  contextTemplate: CognitiveTurnContext
  pendingDrafts: PendingItemDraft[]
  createdAt: string
}

export interface TurnFinalizationPort {
  put(record: TurnFinalizationRecord): void
  get(turnId: string): TurnFinalizationRecord | null
  list(limit: number): TurnFinalizationRecord[]
  remove(turnId: string): void
}

const MAX_FINALIZATION_DRAFTS = 10

export class SqliteTurnFinalizationRepository implements TurnFinalizationPort {
  constructor(private readonly database: SqliteDatabase) {}

  put(record: TurnFinalizationRecord): void {
    this.database.connection.prepare(`
      INSERT INTO cognitive_turn_finalizations(turn_id, conversation_id, user_message_id, assistant_message_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(
      record.turnId,
      record.conversationId,
      record.userMessageId,
      record.assistantMessageId,
      JSON.stringify({ contextTemplate: record.contextTemplate, pendingDrafts: record.pendingDrafts, feelingEventId: record.feelingEventId }),
      record.createdAt
    )
  }

  get(turnId: string): TurnFinalizationRecord | null {
    const row = this.database.connection.prepare(
      'SELECT turn_id, conversation_id, user_message_id, assistant_message_id, payload_json, created_at FROM cognitive_turn_finalizations WHERE turn_id = ?'
    ).get(turnId.toLowerCase()) as FinalizationRow | undefined
    return row ? mapFinalization(row) : null
  }

  list(limit: number): TurnFinalizationRecord[] {
    const rows = this.database.connection.prepare(
      'SELECT turn_id, conversation_id, user_message_id, assistant_message_id, payload_json, created_at FROM cognitive_turn_finalizations ORDER BY created_at LIMIT ?'
    ).all(Math.min(Math.max(limit, 1), 100)) as unknown as FinalizationRow[]
    const records: TurnFinalizationRecord[] = []
    for (const row of rows) {
      const mapped = mapFinalization(row)
      if (mapped) records.push(mapped)
    }
    return records
  }

  remove(turnId: string): void {
    this.database.connection.prepare('DELETE FROM cognitive_turn_finalizations WHERE turn_id = ?').run(turnId.toLowerCase())
  }
}

interface FinalizationRow {
  turn_id: string
  conversation_id: string
  user_message_id: string
  assistant_message_id: string
  payload_json: string
  created_at: string
}

/**
 * A row whose payload cannot be trusted is dropped from recovery rather than
 * partially applied: a half-written context is worse than a missing one.
 */
function mapFinalization(row: FinalizationRow): TurnFinalizationRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload_json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const payload = parsed as Record<string, unknown>
  if (!isCognitiveTurnContext(payload.contextTemplate)) return null
  if (!Array.isArray(payload.pendingDrafts) || payload.pendingDrafts.length > MAX_FINALIZATION_DRAFTS) return null
  const drafts: PendingItemDraft[] = []
  for (const candidate of payload.pendingDrafts as unknown[]) {
    if (!candidate || typeof candidate !== 'object') return null
    const draft = candidate as Record<string, unknown>
    if (typeof draft.id !== 'string' || typeof draft.dedupeKey !== 'string' || typeof draft.summary !== 'string') return null
    if (typeof draft.source !== 'string' || typeof draft.kind !== 'string') return null
    if (typeof draft.priority !== 'number' || typeof draft.createdAt !== 'string') return null
    if (!draft.detail || typeof draft.detail !== 'object' || Array.isArray(draft.detail)) return null
    drafts.push({
      id: draft.id,
      dedupeKey: draft.dedupeKey,
      source: draft.source as PendingItemDraft['source'],
      kind: draft.kind,
      summary: draft.summary,
      priority: draft.priority,
      conversationId: typeof draft.conversationId === 'string' ? draft.conversationId : null,
      detail: draft.detail as Record<string, unknown>,
      createdAt: draft.createdAt
    })
  }
  return {
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    feelingEventId: typeof payload.feelingEventId === 'string' ? payload.feelingEventId : null,
    contextTemplate: payload.contextTemplate,
    pendingDrafts: drafts,
    createdAt: row.created_at
  }
}

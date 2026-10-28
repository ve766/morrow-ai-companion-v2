/**
 * Persistence for Phase 2.4's two new records.
 *
 * Both writes are idempotent by construction, because the turn path can be
 * retried (a re-sent request, a recovery pass after a partial failure) and a
 * retry must never create a second row or resurrect a finished item.
 */
import type { SqliteDatabase } from './database'
import type { CognitiveTurnContext } from '../cognition/turn-context'
import type { PendingItem, PendingItemDraft, PendingItemStatus } from '../cognition/pending-items'
import { isCognitiveTurnContext } from '../cognition/turn-context'

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
  /** Marks an item done. Returns false when it does not exist. */
  complete(id: string, completedAt: string): boolean
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
      WHERE cognitive_turn_contexts.status <> 'succeeded'
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
      return isCognitiveTurnContext(parsed) ? parsed : null
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
        if (isCognitiveTurnContext(parsed)) contexts.push(parsed)
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
    conversationId: row.conversation_id,
    detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}

export class SqlitePendingItemRepository implements PendingItemPort {
  constructor(private readonly database: SqliteDatabase) {}

  upsert(draft: PendingItemDraft): PendingItem {
    // A finished item stays finished: re-observing the same concern must not
    // reopen it, otherwise a resolved conflict would reappear every turn.
    this.database.connection.prepare(`
      INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, conversation_id, detail_json, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL)
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

  complete(id: string, completedAt: string): boolean {
    const updated = this.database.connection.prepare(
      "UPDATE cognitive_pending_items SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'"
    ).run(completedAt, completedAt, id)
    // Idempotent: completing an already-done item is not an error.
    if (updated.changes === 1) return true
    return this.get(id)?.status === 'done'
  }
}

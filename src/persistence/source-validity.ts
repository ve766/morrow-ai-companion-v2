/**
 * Source validity and deletion propagation (Issue #83 P0-C).
 *
 * One service owns the question "is this source still allowed to carry a
 * derived projection?" and the reverse operation "this source disappeared:
 * invalidate its descendants, cancel pending work and rebuild what remains".
 *
 * It deliberately works on the tables that exist in this runtime. It does not
 * invent domain tables: each entry below is a real migration surface.
 */
import type { SqliteDatabase } from './database'
import type { EventLogService } from './event-log'

export interface InvalidationResult {
  lineageNodes: number
  findings: number
  routes: number
  pendingItems: number
  outboxRows: number
  effectRows: number
  projections: number
}

const EMPTY: InvalidationResult = {
  lineageNodes: 0,
  findings: 0,
  routes: 0,
  pendingItems: 0,
  outboxRows: 0,
  effectRows: 0,
  projections: 0
}

export class SourceValidityService {
  private postInvalidate: (() => void) | null = null

  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly events?: EventLogService
  ) {}

  /** Wired after the reflection gate exists; runs once per invalidation transaction. */
  setPostInvalidate(hook: (() => void) | null): void {
    this.postInvalidate = hook
  }

  conversationValid(conversationId: string): boolean {
    try {
      return Boolean(this.database.connection.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(conversationId))
    } catch {
      return false
    }
  }

  messageValid(messageId: string): boolean {
    try {
      return Boolean(this.database.connection.prepare('SELECT 1 AS present FROM messages WHERE id = ?').get(messageId))
    } catch {
      return false
    }
  }

  memoryValid(memoryId: string): boolean {
    try {
      const row = this.database.connection.prepare('SELECT status FROM memories WHERE id = ?').get(memoryId) as { status: string } | undefined
      if (!row || row.status !== 'active') return false
      const boundary = this.database.connection.prepare(
        "SELECT state FROM deletion_journal WHERE entity = 'memory' AND entity_id = ?"
      ).get(memoryId) as { state: string } | undefined
      return boundary === undefined || boundary.state === 'unretracted'
    } catch {
      return false
    }
  }

  /**
   * Invalidate a conversation and everything derived from it. The caller may
   * delete the conversation row afterwards; every statement here is idempotent.
   */
  invalidateConversation(conversationId: string): InvalidationResult {
    const id = conversationId.toLowerCase()
    return this.database.transaction(() => {
      const result: InvalidationResult = { ...EMPTY }
      const turnIds = this.ids(`SELECT DISTINCT turn_id AS id FROM messages WHERE conversation_id = ?`, id)
      const extraTurns = this.ids('SELECT DISTINCT turn_id AS id FROM cognitive_outbox WHERE conversation_id = ?', id)
      for (const turn of extraTurns) if (!turnIds.includes(turn)) turnIds.push(turn)
      const messageIds = this.ids('SELECT id FROM messages WHERE conversation_id = ?', id)
      const eventIds = this.eventIdsFor(turnIds, messageIds, id)

      result.lineageNodes = this.invalidateLineage(eventIds, 'deleted')
      const findingIds = this.findingsForEvents(eventIds)
      if (findingIds.length > 0) {
        const placeholders = findingIds.map(() => '?').join(',')
        try {
          result.pendingItems += Number(this.database.connection.prepare(
            `UPDATE cognitive_pending_items SET status = 'dropped', updated_at = ? WHERE finding_id IN (${placeholders})`
          ).run(this.clock(), ...findingIds).changes)
        } catch {
          // Degraded/older schemas may not have the decision columns yet.
        }
        result.routes += Number(this.database.connection.prepare(
          `DELETE FROM reflection_finding_routes WHERE finding_id IN (${placeholders})`
        ).run(...findingIds).changes)
        result.findings += Number(this.database.connection.prepare(
          `DELETE FROM reflection_findings WHERE id IN (${placeholders})`
        ).run(...findingIds).changes)
        this.runIgnoringMissing('DELETE FROM pending_personality_candidates WHERE finding_id IN (' + placeholders + ')', findingIds)
      }

      // Domain projections that carry the conversation id directly.
      const directDeletes: Array<[string, string]> = [
        ['knowledge_gap_evidence', 'conversation_id'],
        ['cognitive_turn_contexts', 'conversation_id'],
        ['cognitive_turn_finalizations', 'conversation_id'],
        ['turn_states', 'conversation_id'],
        ['turn_trace_events', 'conversation_id'],
        ['intent_readings', 'conversation_id'],
        ['memory_suggestions', 'conversation_id'],
        ['goal_candidates', 'conversation_id'],
        ['relationship_thread_evidence', 'conversation_id'],
        ['relationship_threads', 'conversation_id'],
        ['cognitive_turn_observations', 'conversation_id'],
        ['cognitive_feeling_events', 'conversation_id']
      ]
      for (const [table, column] of directDeletes) {
        result.projections += this.deleteWhere(table, column, id)
      }
      // Per-turn derived signals have no conversation column; delete by turn.
      if (turnIds.length > 0) {
        const placeholders = turnIds.map(() => '?').join(',')
        for (const table of ['personalization_signals', 'personality_growth_signals', 'user_interaction_signals', 'exploration_events']) {
          result.projections += this.runIgnoringMissing(`DELETE FROM ${table} WHERE turn_id IN (${placeholders})`, turnIds)
        }
        for (const table of ['exploration_budget']) {
          result.projections += this.runIgnoringMissing(`DELETE FROM ${table} WHERE turn_id IN (${placeholders})`, turnIds)
        }
        // Goals sourced from a deleted message stay as history but must not be
        // read as active commitments. This matches activeForContext's filter.
        result.projections += this.runIgnoringMissing(
          "UPDATE companion_goals SET status = 'cancelled', updated_at = ? WHERE status = 'active' AND source_message_id IN (" + placeholders + ")",
          [this.clock(), ...messageIds]
        )
      }
      // Self-model entries sourced from the conversation are retracted, not
      // deleted: their statement is derived from user text and must leave the
      // prompt, while the row remains an auditable tombstone.
      result.projections += this.runIgnoringMissing(
        "UPDATE self_model_entries SET status = 'retracted', updated_at = ? WHERE conversation_id = ? AND status != 'retracted'",
        [this.clock(), id]
      )
      // A memory whose only evidence came from this conversation loses its
      // support. It is retracted (readable tombstone) rather than deleted; a
      // memory with evidence from another surviving source stays active.
      const memoryIds = this.ids(
        'SELECT DISTINCT memory_id AS id FROM memory_evidence WHERE conversation_id = ?', id
      )
      for (const memoryId of memoryIds) {
        const survives = this.database.connection.prepare(
          'SELECT 1 AS present FROM memory_evidence WHERE memory_id = ? AND conversation_id != ? LIMIT 1'
        ).get(memoryId, id)
        if (survives) continue
        result.projections += this.runIgnoringMissing(
          "UPDATE memories SET status = 'retracted', updated_at = ? WHERE id = ? AND status = 'active'",
          [this.clock(), memoryId]
        )
        result.lineageNodes += this.runIgnoringMissing(
          "UPDATE evidence_lineage SET state = 'deleted', verified_at = ? WHERE state = 'active' AND (node_id = ? OR root_source_id = ?)",
          [this.clock(), memoryId, memoryId]
        )
        result.projections += this.runIgnoringMissing('DELETE FROM fact_records WHERE source_memory_id = ?', [memoryId])
      }
      // Outbox and effect ledger: cancel pending and fence running work.
      result.outboxRows += this.cancelOutbox(turnIds)
      result.effectRows += this.cancelEffects(turnIds)
      this.postInvalidate?.()
      this.events?.tryRecord({
        sourceModule: 'app',
        eventType: 'source.invalidated',
        actor: 'system',
        subjectType: 'conversation',
        subjectId: id,
        correlationId: null,
        payload: {
          lineage: result.lineageNodes,
          findings: result.findings,
          routes: result.routes,
          pending: result.pendingItems,
          outbox: result.outboxRows,
          effects: result.effectRows,
          projections: result.projections
        }
      })
      return result
    })
  }

  /** Memory delete/retract: mark lineage and derived interest evidence invalid. */
  invalidateMemory(memoryId: string, state: 'deleted' | 'retracted'): InvalidationResult {
    const id = memoryId.toLowerCase()
    return this.database.transaction(() => {
      const result: InvalidationResult = { ...EMPTY }
      result.lineageNodes = Number(this.database.connection.prepare(
        "UPDATE evidence_lineage SET state = ?, verified_at = ? WHERE state = 'active' AND (node_id = ? OR root_source_id = ?)"
      ).run(state, this.clock(), id, id).changes)
      result.projections += this.runIgnoringMissing('DELETE FROM memory_evidence WHERE memory_id = ?', [id])
      result.projections += this.runIgnoringMissing('DELETE FROM interest_evidence WHERE evidence_ref = ?', [id])
      result.projections += this.runIgnoringMissing('DELETE FROM fact_records WHERE source_memory_id = ?', [id])
      this.postInvalidate?.()
      this.events?.tryRecord({
        sourceModule: 'app',
        eventType: 'source.invalidated',
        actor: 'system',
        subjectType: 'memory',
        subjectId: id,
        correlationId: null,
        payload: { state, lineage: result.lineageNodes, projections: result.projections }
      })
      return result
    })
  }

  /** Explicit memory restore is the only path that revives a source. */
  restoreMemory(memoryId: string): number {
    const id = memoryId.toLowerCase()
    return Number(this.database.connection.prepare(
      "UPDATE evidence_lineage SET state = 'active', verified_at = ? WHERE node_id = ? AND derivation_kind = 'origin'"
    ).run(this.clock(), id).changes)
  }

  private eventIdsFor(turnIds: string[], messageIds: string[], conversationId: string): string[] {
    const ids = new Set<string>()
    try {
      const rows = this.database.connection.prepare(
        "SELECT id FROM event_journal WHERE (subject_type = 'conversation' AND subject_id = ?) OR (subject_type = 'message' AND subject_id IN (SELECT id FROM messages WHERE conversation_id = ?))"
      ).all(conversationId, conversationId) as Array<{ id: string }>
      for (const row of rows) ids.add(row.id)
      if (turnIds.length > 0) {
        const placeholders = turnIds.map(() => '?').join(',')
        const correlated = this.database.connection.prepare(
          `SELECT id FROM event_journal WHERE correlation_id IN (${placeholders})`
        ).all(...turnIds) as Array<{ id: string }>
        for (const row of correlated) ids.add(row.id)
      }
      for (const messageId of messageIds) ids.add(messageId)
    } catch {
      // A degraded schema still allows the SQL deletions below; the caller
      // records the lock instead of pretending the lineage was checked.
    }
    return [...ids]
  }

  private invalidateLineage(ids: string[], state: 'deleted'): number {
    if (ids.length === 0) return 0
    const json = JSON.stringify(ids)
    const result = this.database.connection.prepare(`
      WITH RECURSIVE descendants(node_id) AS (
        SELECT node_id FROM evidence_lineage
          WHERE node_id IN (SELECT value FROM json_each(?))
             OR root_source_id IN (SELECT value FROM json_each(?))
        UNION
        SELECT e.node_id FROM evidence_lineage e
          JOIN descendants d ON EXISTS (SELECT 1 FROM json_each(e.parent_ids_json) WHERE value = d.node_id)
      )
      UPDATE evidence_lineage SET state = ?, verified_at = ?
        WHERE node_id IN (SELECT node_id FROM descendants)
    `).run(json, json, state, this.clock())
    return Number(result.changes)
  }

  private findingsForEvents(eventIds: string[]): string[] {
    if (eventIds.length === 0) return []
    const json = JSON.stringify(eventIds)
    try {
      const rows = this.database.connection.prepare(`
        SELECT f.id FROM reflection_findings f
        WHERE EXISTS (
          SELECT 1 FROM json_each(f.evidence_json) e
          WHERE json_extract(e.value, '$.id') IN (SELECT value FROM json_each(?))
        )
      `).all(json) as Array<{ id: string }>
      return rows.map((row) => row.id)
    } catch {
      return []
    }
  }

  private cancelOutbox(turnIds: string[]): number {
    try {
      if (turnIds.length > 0) {
        const placeholders = turnIds.map(() => '?').join(',')
        return Number(this.database.connection.prepare(
          `UPDATE cognitive_outbox SET status = 'cancelled', updated_at = ?
             WHERE status IN ('pending', 'failed') AND turn_id IN (${placeholders})`
        ).run(this.clock(), ...turnIds).changes)
      }
      return 0
    } catch {
      return 0
    }
  }

  private cancelEffects(turnIds: string[]): number {
    if (turnIds.length === 0) return 0
    const placeholders = turnIds.map(() => '?').join(',')
    try {
      return Number(this.database.connection.prepare(`
        UPDATE cognitive_effect_ledger
        SET state = 'terminal_failed', last_error_code = 'source_invalidated',
            claim_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE state IN ('pending', 'running', 'failed_retryable') AND turn_id IN (${placeholders})
      `).run(this.clock(), ...turnIds).changes)
    } catch {
      return 0
    }
  }

  private ids(sql: string, ...parameters: string[]): string[] {
    try {
      return (this.database.connection.prepare(sql).all(...parameters) as Array<{ id: string }>).map((row) => row.id)
    } catch {
      return []
    }
  }

  private deleteWhere(table: string, column: string, id: string): number {
    return this.runIgnoringMissing(`DELETE FROM ${table} WHERE ${column} = ?`, [id])
  }

  private runIgnoringMissing(sql: string, parameters: Array<string | number>): number {
    try {
      return Number(this.database.connection.prepare(sql).run(...parameters).changes)
    } catch {
      return 0
    }
  }
}

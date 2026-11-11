/**
 * Independent evidence for Morrow's own interests (P0-1).
 *
 * A "knowledge gap" is a turn where Morrow could not ground a claim: the guard
 * rewrote the answer. That failure is the only honest signal that a topic is
 * something *she* does not understand yet — it is not the user mentioning the
 * topic more often.
 *
 * The event journal already stores the gap. This table stores the evidence
 * *shape* the interest ledger needs: one row per gap, with its conversation,
 * turn, label, confidence and time, and a pointer to the finding that consumed
 * it. Two consequences follow:
 *
 *   - two gaps in two conversations are countable as two independent supports,
 *     even when they were processed in different reflection batches;
 *   - deleting the source message removes the gap, the interest evidence it
 *     supported, and any aggregate left with nothing.
 *
 * Nothing here copies user text: the label is a derived topic phrase, and the
 * row references the event rather than restating it.
 */
import type { SqliteDatabase } from '../persistence/database'

export interface KnowledgeGapInput {
  eventId: string
  conversationId: string
  turnId: string
  label: string
  confidence?: number
  occurredAt: string
}

export interface KnowledgeGapRow {
  eventId: string
  conversationId: string
  turnId: string
  label: string
  confidence: number
  occurredAt: string
  citedByFindingId: string | null
}

export class KnowledgeGapService {
  constructor(private readonly database: SqliteDatabase) {}

  /**
   * Records one gap. Idempotent on the event id, so a retried turn that
   * regenerated the same deterministic event writes one row.
   */
  record(input: KnowledgeGapInput): void {
    this.database.connection.prepare(`
      INSERT INTO knowledge_gap_evidence(event_id, conversation_id, turn_id, label, owner, confidence, occurred_at, cited_by_finding_id, retracted_at)
      VALUES (?, ?, ?, ?, 'morrow', ?, ?, NULL, NULL)
      ON CONFLICT(event_id) DO NOTHING
    `).run(
      input.eventId,
      input.conversationId,
      input.turnId,
      input.label.slice(0, 64),
      Math.max(0, Math.min(1, input.confidence ?? 0.6)),
      input.occurredAt
    )
  }

  /** Gaps no finding has consumed yet, oldest first. */
  uncited(limit = 200): KnowledgeGapRow[] {
    const rows = this.database.connection.prepare(`
      SELECT event_id, conversation_id, turn_id, label, confidence, occurred_at, cited_by_finding_id
      FROM knowledge_gap_evidence WHERE cited_by_finding_id IS NULL AND retracted_at IS NULL
      ORDER BY occurred_at, event_id LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>
    return rows.map(mapGap)
  }

  all(limit = 500): KnowledgeGapRow[] {
    const rows = this.database.connection.prepare(`
      SELECT event_id, conversation_id, turn_id, label, confidence, occurred_at, cited_by_finding_id
      FROM knowledge_gap_evidence ORDER BY occurred_at, event_id LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>
    return rows.map(mapGap)
  }

  /** Independent conversations behind a label — the independence axis. */
  conversationCount(label: string): number {
    const row = this.database.connection.prepare(`
      SELECT COUNT(DISTINCT conversation_id) AS n FROM knowledge_gap_evidence
      WHERE label = ? AND retracted_at IS NULL
    `).get(label) as { n: number }
    return Number(row.n)
  }
}

function mapGap(row: Record<string, unknown>): KnowledgeGapRow {
  return {
    eventId: String(row.event_id),
    conversationId: String(row.conversation_id),
    turnId: String(row.turn_id),
    label: String(row.label),
    confidence: Number(row.confidence),
    occurredAt: String(row.occurred_at),
    citedByFindingId: row.cited_by_finding_id === null || row.cited_by_finding_id === undefined
      ? null
      : String(row.cited_by_finding_id)
  }
}

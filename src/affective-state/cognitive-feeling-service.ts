import { ApplicationError } from '../shared/errors'
import { isCognitiveUuid } from '../cognition/cognition'
import {
  applyFeelingEvent,
  createDefaultFeelingState,
  decayFeelingState,
  isCognitiveFeelingEvent,
  isFeelingState,
  type CognitiveFeelingEvent,
  type FeelingEventSummary,
  type FeelingState,
  type FeelingStateView
} from './feeling'
import { SqliteDatabase } from '../persistence/database'

export const MAX_COGNITIVE_FEELING_EVENTS = 5000
export const MAX_COGNITIVE_FEELING_HISTORY_SHOWN = 8

interface EventRow {
  event_id: string
  idempotency_key: string
  processed_at: string
  event_json: string
}

interface StateRow {
  state_json: string
  revision: number
  dirty: number
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) throw new ApplicationError('STORAGE_ERROR')
  return new Date(parsed).toISOString()
}

function safeDefault(at: string): FeelingState {
  return createDefaultFeelingState(normalizeTimestamp(at))
}

export interface FeelingEventSink {
  tryRecord(event: {
    sourceModule: 'affective-state'
    eventType: string
    actor: 'system'
    subjectType: string
    subjectId: string | null
    correlationId: string | null
    payload: Record<string, unknown>
  }): unknown | null
}

export class CognitiveFeelingService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly events?: FeelingEventSink
  ) {}

  snapshot(at = this.clock()): FeelingStateView {
    const evaluatedAt = normalizeTimestamp(at)
    if (!this.database.cognitivePersistenceAvailable) {
      return { available: false, state: safeDefault(evaluatedAt), eventCount: 0, recentEvents: [] }
    }
    try {
      return this.database.transaction(() => {
        const current = this.loadOrRebuildState(evaluatedAt)
        return {
          available: true,
          state: decayFeelingState(current, evaluatedAt),
          eventCount: this.countEvents(),
          recentEvents: this.recentEvents()
        }
      })
    } catch {
      return { available: false, state: safeDefault(evaluatedAt), eventCount: 0, recentEvents: [] }
    }
  }

  preview(state: FeelingState, event: CognitiveFeelingEvent | null, at: string): FeelingState {
    const evaluatedAt = normalizeTimestamp(at)
    const current = decayFeelingState(state, evaluatedAt)
    return event ? applyFeelingEvent(current, event, evaluatedAt) : current
  }

  recordCompletedTurn(event: CognitiveFeelingEvent, resultMessageId: string, processedAt = this.clock()): boolean {
    const completedAt = normalizeTimestamp(processedAt)
    return this.database.transaction(() => this.recordCompletedTurnInTransaction(event, resultMessageId, completedAt))
  }

  recordCompletedTurnInTransaction(event: CognitiveFeelingEvent, resultMessageId: string, processedAt = this.clock()): boolean {
    const completedAt = normalizeTimestamp(processedAt)
    if (!this.database.cognitivePersistenceAvailable || !isCognitiveFeelingEvent(event) || !isCognitiveUuid(resultMessageId)) {
      throw new ApplicationError('STORAGE_ERROR')
    }
    const existing = this.database.connection.prepare('SELECT event_json, result_message_id FROM cognitive_feeling_events WHERE idempotency_key = ?')
      .get(event.idempotencyKey) as unknown as { event_json: string; result_message_id: string } | undefined
    if (existing) {
      let stored: unknown
      try {
        stored = JSON.parse(existing.event_json)
      } catch {
        throw new ApplicationError('STORAGE_ERROR')
      }
      if (!isCognitiveFeelingEvent(stored) || existing.result_message_id !== resultMessageId.toLowerCase()) {
        throw new ApplicationError('CONFLICT')
      }
      const { id: _storedId, occurredAt: _storedAt, ...storedSemantics } = stored
      const { id: _incomingId, occurredAt: _incomingAt, ...incomingSemantics } = event
      if (JSON.stringify(storedSemantics) !== JSON.stringify(incomingSemantics)) throw new ApplicationError('CONFLICT')
      return false
    }
    if (this.countEvents() >= MAX_COGNITIVE_FEELING_EVENTS) throw new ApplicationError('STORAGE_ERROR')
    this.assertCompletedTurn(event, resultMessageId.toLowerCase())
    const previous = this.loadOrRebuildState(completedAt)
    const effectiveAt = new Date(Math.max(Date.parse(previous.evaluatedAt), Date.parse(completedAt))).toISOString()
    const stateBefore = decayFeelingState(previous, effectiveAt)
    const stateAfter = applyFeelingEvent(stateBefore, event, effectiveAt)
    const sequence = Number(this.database.connection.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM cognitive_feeling_events'
    ).get()?.sequence ?? 1)
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ApplicationError('STORAGE_ERROR')
    this.database.connection.prepare(`
      INSERT INTO cognitive_feeling_events(
        event_id, sequence, conversation_id, source_message_id, related_assistant_message_id, result_message_id,
        idempotency_key, occurred_at, processed_at, event_type, schema_version, algorithm_version, event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      sequence,
      event.conversationId,
      event.sourceMessageId,
      event.relatedAssistantMessageId,
      resultMessageId.toLowerCase(),
      event.idempotencyKey,
      event.occurredAt,
      stateAfter.evaluatedAt,
      event.type,
      event.schemaVersion,
      event.engineVersion,
      JSON.stringify(event)
    )
    this.database.connection.prepare(`
      INSERT INTO cognitive_feeling_revisions(revision, event_id, processed_at, before_json, after_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(stateAfter.revision, event.id, stateAfter.evaluatedAt, JSON.stringify(stateBefore), JSON.stringify(stateAfter))
    this.writeState(stateAfter)
    // Journal summary for reflection and traceability; the detailed evidence
    // lives in the feeling tables, so the payload stays small.
    this.events?.tryRecord({
      sourceModule: 'affective-state',
      eventType: 'feeling.event_applied',
      actor: 'system',
      subjectType: 'feeling_state',
      subjectId: event.id,
      correlationId: event.conversationId,
      payload: { lastEventType: event.type, revision: stateAfter.revision }
    })
    return true
  }

  clearHistory(): FeelingStateView {
    const clearedAt = normalizeTimestamp(this.clock())
    if (!this.database.cognitivePersistenceAvailable) throw new ApplicationError('STORAGE_ERROR')
    try {
      this.database.transaction(() => {
        this.database.connection.prepare('DELETE FROM cognitive_feeling_events').run()
        this.database.connection.prepare('DELETE FROM cognitive_turn_observations').run()
        this.writeState(safeDefault(clearedAt))
        if (this.countEvents() !== 0 || this.countObservations() !== 0) throw new ApplicationError('STORAGE_ERROR')
      })
    } catch {
      throw new ApplicationError('STORAGE_ERROR')
    }
    const cleared = this.snapshot(clearedAt)
    if (!cleared.available || cleared.eventCount !== 0 || cleared.recentEvents.length !== 0 ||
      cleared.state.revision !== 0 || cleared.state.sourceEventId !== null ||
      Object.values(cleared.state.values).some((value) => value !== 0) ||
      cleared.state.attention.explorationPriority !== 0 || cleared.state.attention.evidenceRefs.length !== 0) {
      throw new ApplicationError('STORAGE_ERROR')
    }
    return cleared
  }

  private assertCompletedTurn(event: CognitiveFeelingEvent, resultMessageId: string): void {
    const source = this.database.connection.prepare(`
      SELECT role, turn_id FROM messages WHERE id = ? AND conversation_id = ?
    `).get(event.sourceMessageId, event.conversationId) as unknown as { role: string; turn_id: string } | undefined
    const result = this.database.connection.prepare(`
      SELECT role, turn_id FROM messages WHERE id = ? AND conversation_id = ?
    `).get(resultMessageId, event.conversationId) as unknown as { role: string; turn_id: string } | undefined
    const observation = this.database.connection.prepare(`
      SELECT 1 AS present FROM cognitive_turn_observations WHERE source_message_id = ? AND conversation_id = ? LIMIT 1
    `).get(event.sourceMessageId, event.conversationId)
    if (source?.role !== 'user' || source.turn_id !== event.idempotencyKey || result?.role !== 'assistant' ||
      result.turn_id !== event.idempotencyKey || !observation) {
      throw new ApplicationError('CONFLICT')
    }
    if (event.relatedAssistantMessageId !== null) {
      const related = this.database.connection.prepare(`
        SELECT role FROM messages WHERE id = ? AND conversation_id = ?
      `).get(event.relatedAssistantMessageId, event.conversationId) as unknown as { role: string } | undefined
      if (related?.role !== 'assistant') throw new ApplicationError('CONFLICT')
    }
  }

  private loadOrRebuildState(at: string): FeelingState {
    const row = this.database.connection.prepare('SELECT state_json, revision, dirty FROM cognitive_feeling_state WHERE id = 1')
      .get() as unknown as StateRow | undefined
    if (!row) return this.rebuildState(at)
    let state: unknown
    try {
      state = JSON.parse(row.state_json)
    } catch {
      state = undefined
    }
    const eventCount = this.countEvents()
    const revisionCount = Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_revisions').get()?.count ?? 0)
    if (!isFeelingState(state) || row.dirty !== 0 || row.revision !== eventCount || state.revision !== row.revision || revisionCount !== eventCount) {
      return this.rebuildState(at)
    }
    return state
  }

  private rebuildState(at: string): FeelingState {
    const rows = this.database.connection.prepare(`
      SELECT event_id, idempotency_key, processed_at, event_json
      FROM cognitive_feeling_events ORDER BY sequence ASC
    `).all() as unknown as EventRow[]
    let state = safeDefault(rows[0]?.processed_at ?? at)
    this.database.connection.prepare('DELETE FROM cognitive_feeling_revisions').run()
    for (const row of rows) {
      let event: unknown
      try {
        event = JSON.parse(row.event_json)
      } catch {
        throw new ApplicationError('STORAGE_ERROR')
      }
      const processedAt = normalizeTimestamp(row.processed_at)
      if (!isCognitiveFeelingEvent(event) || event.id !== row.event_id || event.idempotencyKey !== row.idempotency_key) {
        throw new ApplicationError('STORAGE_ERROR')
      }
      const before = decayFeelingState(state, processedAt)
      const after = applyFeelingEvent(before, event, processedAt)
      this.database.connection.prepare(`
        INSERT INTO cognitive_feeling_revisions(revision, event_id, processed_at, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(after.revision, event.id, processedAt, JSON.stringify(before), JSON.stringify(after))
      state = after
    }
    this.writeState(state)
    return state
  }

  private writeState(state: FeelingState): void {
    if (!isFeelingState(state)) throw new ApplicationError('STORAGE_ERROR')
    const result = this.database.connection.prepare(`
      UPDATE cognitive_feeling_state SET schema_version = ?, algorithm_version = ?, state_json = ?, revision = ?, dirty = 0, updated_at = ?
      WHERE id = 1
    `).run(state.schemaVersion, state.engineVersion, JSON.stringify(state), state.revision, state.evaluatedAt)
    if (result.changes !== 1) throw new ApplicationError('STORAGE_ERROR')
  }

  private countEvents(): number {
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_events').get()?.count ?? 0)
  }

  private countObservations(): number {
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()?.count ?? 0)
  }

  private recentEvents(): FeelingEventSummary[] {
    const rows = this.database.connection.prepare(`
      SELECT e.event_json, r.processed_at, r.after_json
      FROM cognitive_feeling_revisions r
      JOIN cognitive_feeling_events e ON e.event_id = r.event_id
      ORDER BY r.revision DESC LIMIT ?
    `).all(MAX_COGNITIVE_FEELING_HISTORY_SHOWN) as unknown as Array<{ event_json: string; processed_at: string; after_json: string }>
    return rows.map((row) => {
      const event: unknown = JSON.parse(row.event_json)
      const state: unknown = JSON.parse(row.after_json)
      if (!isCognitiveFeelingEvent(event) || !isFeelingState(state)) throw new ApplicationError('STORAGE_ERROR')
      return {
        type: event.type,
        occurredAt: event.occurredAt,
        processedAt: normalizeTimestamp(row.processed_at),
        meaning: event.interpretation.meaning,
        importanceScore: event.interpretation.importanceScore,
        confidenceScore: event.interpretation.confidenceScore,
        uncertainty: event.interpretation.uncertainty,
        proposedDeltas: { ...event.proposedDeltas },
        proposedAttentionDelta: event.proposedAttentionDelta,
        stateAfter: { ...state.values },
        attentionAfter: state.attention.explorationPriority
      }
    }).reverse()
  }
}

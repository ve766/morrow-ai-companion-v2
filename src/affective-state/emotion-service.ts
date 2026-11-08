/**
 * Durable affect authority (Issue #72).
 *
 * One event row per completed turn, one decaying projection, and one revision
 * row per applied event. The projection is a fold over the event log, so a
 * restart, a deleted message or a replay converges on the same state.
 */
import { createHash } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import { isCognitiveUuid } from '../cognition/cognition'
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'
import {
  EMOTION_ALGORITHM_VERSION,
  EMOTION_SCHEMA_VERSION,
  createInitialAffectState,
  decayAffect,
  isAffectState,
  isEmotionCandidate,
  mergeEmotionCandidates,
  regulateEmotion,
  type AffectState,
  type AppraisalComponents,
  type EmotionCandidate,
  type EmotionSourceKind,
  type EmotionUncertainty,
  type EmotionRegulationState
} from './emotion-model'
import type { AppraisalResult } from './appraisal-engine'

export interface EmotionEventDraft {
  eventId: string
  idempotencyKey: string
  conversationId: string
  sourceMessageId: string
  assistantMessageId: string | null
  occurredAt: string
  sourceKind: EmotionSourceKind
  topicTags: string[]
  appraisal: AppraisalResult
  accepted: EmotionCandidate[]
  confidence: number
  uncertainty: EmotionUncertainty
  conflict: boolean
}

export interface EmotionEventRecord extends EmotionEventDraft {
  sequence: number
  processedAt: string
}

interface EventRow {
  event_id: string
  sequence: number
  conversation_id: string
  source_message_id: string
  assistant_message_id: string | null
  idempotency_key: string
  occurred_at: string
  processed_at: string
  event_json: string
}

interface StateRow {
  state_json: string
  revision: number
  dirty: number
}

interface EventJson {
  schemaVersion: typeof EMOTION_SCHEMA_VERSION
  algorithmVersion: typeof EMOTION_ALGORITHM_VERSION
  event: EmotionEventDraft
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) throw new ApplicationError('STORAGE_ERROR')
  return new Date(parsed).toISOString()
}

/** Stable UUID from a seed, so a rebuild creates the same emotion ids. */
export function deterministicEmotionId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const compact = hex.join('')
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`
}

function isDraft(value: unknown): value is EmotionEventDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Record<string, unknown>
  if (typeof draft.eventId !== 'string' || !isCognitiveUuid(draft.eventId)) return false
  if (typeof draft.idempotencyKey !== 'string' || !isCognitiveUuid(draft.idempotencyKey)) return false
  if (typeof draft.conversationId !== 'string' || !isCognitiveUuid(draft.conversationId)) return false
  if (typeof draft.sourceMessageId !== 'string' || !isCognitiveUuid(draft.sourceMessageId)) return false
  if (draft.assistantMessageId !== null && (typeof draft.assistantMessageId !== 'string' || !isCognitiveUuid(draft.assistantMessageId))) return false
  if (typeof draft.occurredAt !== 'string' || !draft.occurredAt.endsWith('Z') || !Number.isFinite(Date.parse(draft.occurredAt))) return false
  if (typeof draft.sourceKind !== 'string' || !['morrow_self_appraisal', 'user_context', 'shared_interaction', 'system_evidence'].includes(draft.sourceKind)) return false
  if (!Array.isArray(draft.topicTags) || draft.topicTags.length > 8 || !draft.topicTags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 48)) return false
  if (!Array.isArray(draft.accepted) || draft.accepted.length > 12 || !draft.accepted.every(isEmotionCandidate)) return false
  if (!Number.isFinite(draft.confidence) || Number(draft.confidence) < 0 || Number(draft.confidence) > 1) return false
  if (draft.uncertainty !== 'low' && draft.uncertainty !== 'medium' && draft.uncertainty !== 'high') return false
  if (typeof draft.conflict !== 'boolean') return false
  const appraisal = draft.appraisal as Record<string, unknown> | undefined
  if (!appraisal || typeof appraisal !== 'object') return false
  const components = appraisal.components as AppraisalComponents | undefined
  if (!components || !Number.isFinite(components.goalRelevance) || !Number.isFinite(components.goalCongruence) ||
    !Number.isFinite(components.novelty) || !Number.isFinite(components.agency) || !Number.isFinite(components.certainty) ||
    !Number.isFinite(components.responsibility) || !Number.isFinite(components.relationshipRelevance) ||
    !Number.isFinite(components.expectationGap)) return false
  return true
}

function parseEventJson(value: string): EmotionEventDraft {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new ApplicationError('STORAGE_ERROR') }
  if (!parsed || typeof parsed !== 'object') throw new ApplicationError('STORAGE_ERROR')
  const envelope = parsed as Partial<EventJson>
  if (envelope.schemaVersion !== EMOTION_SCHEMA_VERSION || envelope.algorithmVersion !== EMOTION_ALGORITHM_VERSION || !isDraft(envelope.event)) {
    throw new ApplicationError('STORAGE_ERROR')
  }
  return envelope.event
}

export class EmotionService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly events?: EventLogService
  ) {}

  get available(): boolean {
    return this.database.schemaVersion >= 55 && this.database.cognitivePersistenceAvailable
  }

  snapshot(at = this.clock()): AffectState {
    const evaluatedAt = normalizeTimestamp(at)
    if (!this.available) return createInitialAffectState(evaluatedAt)
    try {
      return this.database.transaction(() => decayAffect(this.loadOrRebuild(evaluatedAt), evaluatedAt))
    } catch {
      return createInitialAffectState(evaluatedAt)
    }
  }

  recordInTransaction(draft: EmotionEventDraft, assistantMessageId: string | null, processedAt = this.clock()): boolean {
    const at = normalizeTimestamp(processedAt)
    if (!this.available || !isDraft(draft)) throw new ApplicationError('STORAGE_ERROR')
    if (assistantMessageId !== null && !isCognitiveUuid(assistantMessageId)) throw new ApplicationError('STORAGE_ERROR')
    if (assistantMessageId !== null && draft.assistantMessageId !== null && assistantMessageId.toLowerCase() !== draft.assistantMessageId.toLowerCase()) throw new ApplicationError('CONFLICT')
    if (assistantMessageId === null && draft.assistantMessageId !== null) throw new ApplicationError('CONFLICT')
    const existing = this.database.connection.prepare(
      'SELECT event_json, assistant_message_id FROM emotion_events WHERE idempotency_key = ?'
    ).get(draft.idempotencyKey) as { event_json: string; assistant_message_id: string | null } | undefined
    if (existing) {
      const stored = parseEventJson(existing.event_json)
      if (existing.assistant_message_id !== (assistantMessageId?.toLowerCase() ?? null) || stored.eventId !== draft.eventId ||
        JSON.stringify(stored.accepted) !== JSON.stringify(draft.accepted) ||
        JSON.stringify(stored.appraisal.components) !== JSON.stringify(draft.appraisal.components)) {
        throw new ApplicationError('CONFLICT')
      }
      return false
    }
    this.assertTurnMessages(draft, assistantMessageId?.toLowerCase() ?? null)
    const previous = this.loadOrRebuild(at)
    const effectiveAt = new Date(Math.max(Date.parse(previous.evaluatedAt), Date.parse(at))).toISOString()
    const before = decayAffect(previous, effectiveAt)
    let newEmotionIndex = 0
    const after = mergeEmotionCandidates({
      state: before,
      candidates: draft.accepted,
      eventId: draft.eventId,
      at: effectiveAt,
      makeId: () => deterministicEmotionId(`${draft.eventId}:${newEmotionIndex++}`)
    })
    const sequence = Number(this.database.connection.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM emotion_events'
    ).get()?.sequence ?? 1)
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ApplicationError('STORAGE_ERROR')
    const envelope: EventJson = { schemaVersion: EMOTION_SCHEMA_VERSION, algorithmVersion: EMOTION_ALGORITHM_VERSION, event: draft }
    this.database.connection.prepare(`
      INSERT INTO emotion_events(
        event_id, sequence, conversation_id, source_message_id, assistant_message_id, idempotency_key,
        occurred_at, processed_at, actor, source_kind, event_json, schema_version, algorithm_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'morrow', ?, ?, ?, ?)
    `).run(
      draft.eventId,
      sequence,
      draft.conversationId.toLowerCase(),
      draft.sourceMessageId.toLowerCase(),
      assistantMessageId?.toLowerCase() ?? null,
      draft.idempotencyKey.toLowerCase(),
      normalizeTimestamp(draft.occurredAt),
      effectiveAt,
      draft.sourceKind,
      JSON.stringify(envelope),
      EMOTION_SCHEMA_VERSION,
      EMOTION_ALGORITHM_VERSION
    )
    this.database.connection.prepare(`
      INSERT INTO emotion_revisions(revision, event_id, processed_at, before_json, after_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(after.revision, draft.eventId, effectiveAt, JSON.stringify(before), JSON.stringify(after))
    this.writeState(after)
    this.events?.tryRecord({
      sourceModule: 'affective-state',
      eventType: 'affect.emotion_applied',
      actor: 'system',
      subjectType: 'morrow_affect_event',
      subjectId: draft.eventId,
      correlationId: draft.conversationId,
      payload: {
        accepted: draft.accepted.length,
        families: [...new Set(draft.accepted.map((candidate) => candidate.family))],
        conflict: draft.conflict,
        revision: after.revision
      }
    })
    return true
  }

  record(draft: EmotionEventDraft, assistantMessageId: string | null, processedAt = this.clock()): boolean {
    return this.database.transaction(() => this.recordInTransaction(draft, assistantMessageId, processedAt))
  }

  /** Explicit reappraisal/retraction; never inferred from elapsed time. */
  regulate(input: {
    emotionId: string
    kind: 'reappraised' | 'regulated' | 'retracted'
    rationale: string
    at?: string
  }): AffectState {
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    if (!isCognitiveUuid(input.emotionId)) throw new ApplicationError('INVALID_INPUT')
    const at = normalizeTimestamp(input.at ?? this.clock())
    return this.database.transaction(() => {
      const current = this.loadOrRebuild(at)
      const next = regulateEmotion({
        state: current,
        emotionId: input.emotionId.toLowerCase(),
        regulationState: input.kind === 'reappraised' ? 'regulated' : input.kind,
        rationale: input.rationale,
        at,
        intensityScale: input.kind === 'reappraised' ? 0.5 : input.kind === 'retracted' ? 0 : 0.35
      })
      this.database.connection.prepare(`
        INSERT INTO emotion_regulations(id, emotion_id, event_id, kind, rationale, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(this.makeId().toLowerCase(), input.emotionId.toLowerCase(), current.lastEventId, input.kind,
        input.rationale.trim().slice(0, 240), at)
      this.writeState(next)
      return next
    })
  }

  listEvents(limit = 20): EmotionEventRecord[] {
    if (!this.available) return []
    const rows = this.database.connection.prepare(
      'SELECT event_id, sequence, conversation_id, source_message_id, assistant_message_id, idempotency_key, occurred_at, processed_at, event_json FROM emotion_events ORDER BY sequence DESC LIMIT ?'
    ).all(Math.max(1, Math.min(200, limit))) as unknown as EventRow[]
    return rows.map((row) => ({ ...parseEventJson(row.event_json), sequence: row.sequence, processedAt: normalizeTimestamp(row.processed_at) }))
  }

  clearHistory(at = this.clock()): AffectState {
    const clearedAt = normalizeTimestamp(at)
    if (!this.available) throw new ApplicationError('STORAGE_ERROR')
    return this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM emotion_regulations').run()
      this.database.connection.prepare('DELETE FROM emotion_events').run()
      const reset = createInitialAffectState(clearedAt)
      this.writeState(reset)
      return reset
    })
  }

  /** Message/conversation deletion propagation; the projection is rebuilt. */
  deleteConversation(conversationId: string, at = this.clock()): number {
    if (!this.available) return 0
    const id = conversationId.toLowerCase()
    const atIso = normalizeTimestamp(at)
    return this.database.transaction(() => {
      const removed = Number(this.database.connection.prepare('DELETE FROM emotion_events WHERE conversation_id = ?').run(id).changes)
      // The conversation FK may already have cascaded the event rows. Rebuild
      // unconditionally so a projection cannot keep a deleted emotion alive.
      this.rebuildState(atIso)
      return removed
    })
  }

  private assertTurnMessages(draft: EmotionEventDraft, assistantMessageId: string | null): void {
    const source = this.database.connection.prepare('SELECT role FROM messages WHERE id = ? AND conversation_id = ?')
      .get(draft.sourceMessageId.toLowerCase(), draft.conversationId.toLowerCase()) as { role: string } | undefined
    if (source?.role !== 'user') throw new ApplicationError('CONFLICT')
    if (assistantMessageId !== null) {
      const assistant = this.database.connection.prepare('SELECT role FROM messages WHERE id = ? AND conversation_id = ?')
        .get(assistantMessageId, draft.conversationId.toLowerCase()) as { role: string } | undefined
      if (assistant?.role !== 'assistant') throw new ApplicationError('CONFLICT')
    }
  }

  private loadOrRebuild(at: string): AffectState {
    const row = this.database.connection.prepare('SELECT state_json, revision, dirty FROM emotion_states WHERE id = 1')
      .get() as unknown as StateRow | undefined
    if (!row) return this.rebuildState(at)
    let state: unknown
    try { state = JSON.parse(row.state_json) } catch { state = undefined }
    const eventCount = this.countEvents()
    if (!isAffectState(state) || row.dirty !== 0 || row.revision !== state.revision || state.revision < eventCount) {
      return this.rebuildState(at)
    }
    return state
  }

  private rebuildState(at: string): AffectState {
    const rows = this.database.connection.prepare(`
      SELECT event_id, sequence, conversation_id, source_message_id, assistant_message_id, idempotency_key, occurred_at, processed_at, event_json
      FROM emotion_events ORDER BY sequence ASC
    `).all() as unknown as EventRow[]
    this.database.connection.prepare('DELETE FROM emotion_revisions').run()
    let state = createInitialAffectState(rows[0]?.processed_at ?? at)
    for (const row of rows) {
      const draft = parseEventJson(row.event_json)
      if (draft.eventId !== row.event_id || draft.idempotencyKey !== row.idempotency_key) throw new ApplicationError('STORAGE_ERROR')
      const processedAt = normalizeTimestamp(row.processed_at)
      const before = decayAffect(state, processedAt)
      let newEmotionIndex = 0
      const after = mergeEmotionCandidates({
        state: before,
        candidates: draft.accepted,
        eventId: draft.eventId,
        at: processedAt,
        makeId: () => deterministicEmotionId(`${draft.eventId}:${newEmotionIndex++}`)
      })
      this.database.connection.prepare(`
        INSERT INTO emotion_revisions(revision, event_id, processed_at, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(after.revision, draft.eventId, processedAt, JSON.stringify(before), JSON.stringify(after))
      state = after
    }
    // Regulations are explicit evidence. Reapply them after the event fold so a
    // rebuild cannot silently resurrect a retracted emotion.
    const regulations = this.database.connection.prepare(
      'SELECT emotion_id, kind, rationale, created_at FROM emotion_regulations ORDER BY created_at, rowid'
    ).all() as Array<{ emotion_id: string; kind: 'reappraised' | 'regulated' | 'retracted'; rationale: string; created_at: string }>
    for (const regulation of regulations) {
      const exists = state.emotions.some((emotion) => emotion.emotionId === regulation.emotion_id)
      if (!exists) continue
      state = regulateEmotion({
        state,
        emotionId: regulation.emotion_id,
        regulationState: regulation.kind === 'reappraised' ? 'regulated' : regulation.kind,
        rationale: regulation.rationale,
        at: normalizeTimestamp(regulation.created_at),
        intensityScale: regulation.kind === 'reappraised' ? 0.5 : regulation.kind === 'retracted' ? 0 : 0.35
      })
    }
    this.writeState(state)
    return state
  }

  private writeState(state: AffectState): void {
    if (!isAffectState(state)) throw new ApplicationError('STORAGE_ERROR')
    const result = this.database.connection.prepare(`
      UPDATE emotion_states SET state_json = ?, revision = ?, dirty = 0, updated_at = ? WHERE id = 1
    `).run(JSON.stringify(state), state.revision, state.evaluatedAt)
    if (result.changes !== 1) throw new ApplicationError('STORAGE_ERROR')
  }

  private countEvents(): number {
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM emotion_events').get()?.count ?? 0)
  }
}

/** Re-exported for services that only need the regulation vocabulary. */
export type { EmotionRegulationState }

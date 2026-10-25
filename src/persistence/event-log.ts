import type { SqliteDatabase } from './database.ts'

export const EVENT_LOG_SCHEMA_VERSION = 1 as const

export const EVENT_SOURCE_MODULES = [
  'app', 'conversation', 'memory', 'personality', 'cognition', 'affective-state',
  'motivation', 'self-model', 'providers', 'security', 'persistence'
] as const

export type EventSourceModule = (typeof EVENT_SOURCE_MODULES)[number]
export type EventActor = 'user' | 'system' | 'provider'

export interface MorrowEvent {
  id: string
  schemaVersion: typeof EVENT_LOG_SCHEMA_VERSION
  occurredAt: string
  sourceModule: EventSourceModule
  eventType: string
  actor: EventActor
  subjectType: string
  subjectId: string | null
  correlationId: string | null
  payload: Record<string, unknown>
}

export interface EventQuery {
  sourceModule?: EventSourceModule
  eventType?: string
  subjectType?: string
  subjectId?: string | null
  correlationId?: string
  limit?: number
  ascending?: boolean
}

interface EventRow {
  id: string
  schema_version: number
  occurred_at: string
  source_module: string
  event_type: string
  actor: string
  subject_type: string
  subject_id: string | null
  correlation_id: string | null
  payload_json: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40 || !value.endsWith('Z')) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  try {
    return new Date(parsed).toISOString() === value
  } catch {
    return false
  }
}

export function validateMorrowEvent(event: MorrowEvent): void {
  if (!uuidPattern.test(event.id)) throw new TypeError('Event id must be a lowercase uuid.')
  if (event.schemaVersion !== EVENT_LOG_SCHEMA_VERSION) throw new TypeError('Event schema version is unsupported.')
  if (!isIsoTimestamp(event.occurredAt)) throw new TypeError('Event occurredAt must be an ISO timestamp.')
  if (!EVENT_SOURCE_MODULES.includes(event.sourceModule)) throw new TypeError('Event source module is unknown.')
  if (!/^[a-z0-9_-]{2,32}(.[a-z0-9_-]{2,32}){1,3}$/u.test(event.eventType)) throw new TypeError('Event type must be a namespaced identifier.')
  if (event.actor !== 'user' && event.actor !== 'system' && event.actor !== 'provider') throw new TypeError('Event actor is invalid.')
  if (typeof event.subjectType !== 'string' || event.subjectType.length < 1 || event.subjectType.length > 64) throw new TypeError('Event subject type is invalid.')
  if (event.subjectId !== null && (typeof event.subjectId !== 'string' || event.subjectId.length > 128)) throw new TypeError('Event subject id is invalid.')
  if (event.correlationId !== null && (typeof event.correlationId !== 'string' || event.correlationId.length > 128)) throw new TypeError('Event correlation id is invalid.')
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new TypeError('Event payload must be an object.')
  if (Object.keys(event.payload).length > 32) throw new TypeError('Event payload has too many fields.')
  for (const [key, value] of Object.entries(event.payload)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(key)) throw new TypeError('Event payload key is invalid.')
    const serialized = JSON.stringify(value)
    if (serialized === undefined || serialized.length > 2000) throw new TypeError('Event payload value is too large.')
  }
}

export function serializeEventPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

export function deserializeEventPayload(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Stored event payload is invalid.')
  return parsed as Record<string, unknown>
}

export class EventLogService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  record(event: Omit<MorrowEvent, 'schemaVersion' | 'occurredAt' | 'id'> & { id?: string; occurredAt?: string }): MorrowEvent {
    const full: MorrowEvent = {
      id: (event.id ?? this.makeId()).toLowerCase(),
      schemaVersion: EVENT_LOG_SCHEMA_VERSION,
      occurredAt: event.occurredAt ?? this.clock(),
      sourceModule: event.sourceModule,
      eventType: event.eventType,
      actor: event.actor,
      subjectType: event.subjectType,
      subjectId: event.subjectId ?? null,
      correlationId: event.correlationId ?? null,
      payload: event.payload
    }
    validateMorrowEvent(full)
    this.database.connection.prepare(`
      INSERT INTO event_journal(id, schema_version, occurred_at, source_module, event_type, actor, subject_type, subject_id, correlation_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id, full.schemaVersion, full.occurredAt, full.sourceModule, full.eventType, full.actor,
      full.subjectType, full.subjectId, full.correlationId, serializeEventPayload(full.payload)
    )
    return full
  }

  /** Best-effort recording for observability paths that must not break the loop. */
  tryRecord(event: Omit<MorrowEvent, 'schemaVersion' | 'occurredAt' | 'id'>): MorrowEvent | null {
    try {
      return this.record(event)
    } catch {
      return null
    }
  }

  list(query: EventQuery = {}): MorrowEvent[] {
    const conditions: string[] = []
    const parameters: Array<string | number> = []
    if (query.sourceModule !== undefined) { conditions.push('source_module = ?'); parameters.push(query.sourceModule) }
    if (query.eventType !== undefined) { conditions.push('event_type = ?'); parameters.push(query.eventType) }
    if (query.subjectType !== undefined) { conditions.push('subject_type = ?'); parameters.push(query.subjectType) }
    if (query.subjectId !== undefined) {
      if (query.subjectId === null) conditions.push('subject_id IS NULL')
      else { conditions.push('subject_id = ?'); parameters.push(query.subjectId) }
    }
    if (query.correlationId !== undefined) { conditions.push('correlation_id = ?'); parameters.push(query.correlationId) }
    const limit = query.limit === undefined ? 100 : Math.min(Math.max(1, Math.floor(query.limit)), 500)
    const order = query.ascending ? 'ASC' : 'DESC'
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.database.connection.prepare(
      `SELECT id, schema_version, occurred_at, source_module, event_type, actor, subject_type, subject_id, correlation_id, payload_json
       FROM event_journal ${where} ORDER BY seq ${order} LIMIT ${limit}`
    ).all(...parameters) as unknown as EventRow[]
    return rows.map((row) => ({
      id: row.id,
      schemaVersion: row.schema_version as typeof EVENT_LOG_SCHEMA_VERSION,
      occurredAt: row.occurred_at,
      sourceModule: row.source_module as EventSourceModule,
      eventType: row.event_type,
      actor: row.actor as EventActor,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      correlationId: row.correlation_id,
      payload: deserializeEventPayload(row.payload_json)
    }))
  }

  count(eventType?: string): number {
    if (eventType === undefined) {
      return Number(this.database.connection.prepare('SELECT COUNT(*) AS total FROM event_journal').get()?.total ?? 0)
    }
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS total FROM event_journal WHERE event_type = ?').get(eventType)?.total ?? 0)
  }
}

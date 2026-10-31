import { createHash } from 'node:crypto'
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
  /**
   * Monotonic journal position, assigned by SQLite.
   *
   * A reflection consumer pages by this value, not by `occurred_at`: two events
   * can share a timestamp, and only `seq` gives a total order that never
   * repeats or skips. Undefined for events that were never read back.
   */
  seq?: number
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
  seq: number
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

/**
 * A stable uuid derived from a caller-chosen key.
 *
 * Two properties matter here: the same key always yields the same id, so a
 * retried turn writes one row instead of two; and the result is a valid
 * lowercase uuid, so the journal's own validation still applies.
 */
export function deterministicEventId(key: string): string {
  const digest = createHash('sha256').update(`morrow.event:${key}`).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  // Version 5 (name-based) and the RFC 4122 variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function mapEventRow(row: EventRow): MorrowEvent {
  return {
    seq: Number(row.seq),
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
  }
}

export class EventLogService {  constructor(
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

  /**
   * Records an event whose identity is derived from `idempotencyKey`.
   *
   * Unlike `tryRecord`, this throws on every failure except a duplicate: a
   * caller that needs the event to be durable (the knowledge-gap path) gets a
   * rollback instead of a silent gap. A duplicate means a retried turn already
   * wrote it, which is the desired outcome, so it returns `inserted: false`
   * rather than failing.
   */
  recordDeterministic(
    idempotencyKey: string,
    event: Omit<MorrowEvent, 'schemaVersion' | 'id' | 'occurredAt'> & { occurredAt?: string }
  ): { event: MorrowEvent; inserted: boolean } {
    const full: MorrowEvent = {
      id: deterministicEventId(idempotencyKey),
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
    const result = this.database.connection.prepare(`
      INSERT INTO event_journal(id, schema_version, occurred_at, source_module, event_type, actor, subject_type, subject_id, correlation_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      full.id, full.schemaVersion, full.occurredAt, full.sourceModule, full.eventType, full.actor,
      full.subjectType, full.subjectId, full.correlationId, serializeEventPayload(full.payload)
    )
    return { event: full, inserted: Number(result.changes) > 0 }
  }

  /**
   * Reads events strictly after a journal position.
   *
   * This is the paging primitive reflection needs: `seq > cursor ORDER BY seq
   * ASC LIMIT n`. Ordering by `occurred_at` cannot express "after what I last
   * processed", and the old `ascending: true` read always returned the oldest
   * rows, so a long-lived install stopped seeing new evidence entirely.
   */
  listAfter(afterSeq: number, limit = 200): MorrowEvent[] {
    const bounded = Math.min(Math.max(1, Math.floor(limit)), 500)
    const rows = this.database.connection.prepare(
      `SELECT seq, id, schema_version, occurred_at, source_module, event_type, actor, subject_type, subject_id, correlation_id, payload_json
       FROM event_journal WHERE seq > ? ORDER BY seq ASC LIMIT ${bounded}`
    ).all(Math.max(0, Math.floor(afterSeq))) as unknown as EventRow[]
    return rows.map(mapEventRow)
  }

  /** Whether an event with this id is still in the journal. */
  exists(eventId: string): boolean {
    const row = this.database.connection.prepare('SELECT 1 AS ok FROM event_journal WHERE id = ?').get(eventId)
    return row !== undefined
  }

  /** Highest journal position, or 0 when the journal is empty. */
  latestSeq(): number {
    const row = this.database.connection.prepare('SELECT MAX(seq) AS seq FROM event_journal').get() as { seq: number | null } | undefined
    return row?.seq === null || row?.seq === undefined ? 0 : Number(row.seq)
  }

  /** How many events a consumer at `afterSeq` has not examined yet. */
  backlogAfter(afterSeq: number): number {
    const row = this.database.connection.prepare('SELECT COUNT(*) AS n FROM event_journal WHERE seq > ?').get(Math.max(0, Math.floor(afterSeq))) as { n: number }
    return Number(row.n)
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
      `SELECT seq, id, schema_version, occurred_at, source_module, event_type, actor, subject_type, subject_id, correlation_id, payload_json
       FROM event_journal ${where} ORDER BY seq ${order} LIMIT ${limit}`
    ).all(...parameters) as unknown as EventRow[]
    return rows.map(mapEventRow)
  }

  count(eventType?: string): number {
    if (eventType === undefined) {
      return Number(this.database.connection.prepare('SELECT COUNT(*) AS total FROM event_journal').get()?.total ?? 0)
    }
    return Number(this.database.connection.prepare('SELECT COUNT(*) AS total FROM event_journal WHERE event_type = ?').get(eventType)?.total ?? 0)
  }
}

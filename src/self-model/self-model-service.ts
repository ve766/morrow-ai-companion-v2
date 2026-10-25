import type { EventLogService } from '../persistence/event-log'
import type { SelfModelEntry, SelfModelKind } from './self-model-domain'

export interface SelfModelRepositoryPort {
  all(): SelfModelEntry[]
  create(record: SelfModelEntry): void
  updateStatus(id: string, status: SelfModelEntry['status'], supersededBy: string | null, updatedAt: string): void
}

interface SelfModelRow {
  id: string
  kind: string
  statement: string
  status: string
  confidence: number
  source_message_id: string | null
  conversation_id: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
}

export class SqliteSelfModelRepository implements SelfModelRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  all(): SelfModelEntry[] {
    const rows = this.database.connection.prepare('SELECT * FROM self_model_entries ORDER BY updated_at DESC, id').all() as unknown as SelfModelRow[]
    return rows.map(mapEntry)
  }

  create(record: SelfModelEntry): void {
    this.database.connection.prepare(`
      INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.kind, record.statement, record.status, record.confidence, record.sourceMessageId, record.conversationId, record.supersededBy, record.createdAt, record.updatedAt)
  }

  updateStatus(id: string, status: SelfModelEntry['status'], supersededBy: string | null, updatedAt: string): void {
    this.database.connection.prepare(
      'UPDATE self_model_entries SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?'
    ).run(status, supersededBy, updatedAt, id)
  }
}

function mapEntry(row: SelfModelRow): SelfModelEntry {
  return {
    id: row.id,
    kind: row.kind as SelfModelKind,
    statement: row.statement,
    status: row.status as SelfModelEntry['status'],
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    conversationId: row.conversation_id,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function validateStatement(statement: string): string {
  const trimmed = statement.trim()
  if (trimmed.length < 1 || trimmed.length > 4000 || trimmed.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)) {
    throw new TypeError('Self-model statement is invalid.')
  }
  return trimmed
}

function validateConfidence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new TypeError('Self-model confidence is invalid.')
  return value
}

export class SelfModelService {
  constructor(
    private readonly repository: SelfModelRepositoryPort,
    private readonly events: EventLogService | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  list(filter: { status?: SelfModelEntry['status']; kind?: SelfModelKind } = {}): SelfModelEntry[] {
    return this.repository.all()
      .filter((entry) => (filter.status ? entry.status === filter.status : entry.status !== 'retracted'))
      .filter((entry) => (filter.kind ? entry.kind === filter.kind : true))
  }

  record(input: {
    kind: SelfModelKind
    statement: string
    confidence?: number
    sourceMessageId?: string | null
    conversationId?: string | null
    correlationId?: string | null
  }): SelfModelEntry {
    const statement = validateStatement(input.statement)
    const confidence = validateConfidence(input.confidence ?? (input.kind === 'fact' ? 60 : input.kind === 'inference' ? 45 : 30))
    const at = this.safeTimestamp(this.clock())
    const entry: SelfModelEntry = {
      id: this.makeId().toLowerCase(),
      kind: input.kind,
      statement,
      status: 'active',
      confidence,
      sourceMessageId: input.sourceMessageId ?? null,
      conversationId: input.conversationId ?? null,
      supersededBy: null,
      createdAt: at,
      updatedAt: at
    }
    this.repository.create(entry)
    this.recordEvent('selfmodel.recorded', entry, input.correlationId ?? null, { kind: entry.kind })
    return entry
  }

  /** Supersedes an active entry with a corrected statement; the old entry stays inspectable. */
  correct(entryId: string, statement: string, options: { confidence?: number; correlationId?: string | null } = {}): SelfModelEntry {
    const current = this.repository.all().find((entry) => entry.id === entryId)
    if (!current) throw new TypeError('Self-model entry not found.')
    if (current.status !== 'active') throw new TypeError('Only active self-model entries can be corrected.')
    const at = this.safeTimestamp(this.clock())
    const correction = this.record({
      kind: 'correction',
      statement,
      confidence: options.confidence ?? Math.min(100, current.confidence + 10),
      sourceMessageId: current.sourceMessageId,
      conversationId: current.conversationId,
      correlationId: options.correlationId ?? null
    })
    this.repository.updateStatus(entryId, 'superseded', correction.id, at)
    this.recordEvent('selfmodel.corrected', correction, options.correlationId ?? null, { supersedes: entryId })
    return correction
  }

  retract(entryId: string): void {
    const current = this.repository.all().find((entry) => entry.id === entryId)
    if (!current) throw new TypeError('Self-model entry not found.')
    if (current.status !== 'active') throw new TypeError('Only active self-model entries can be retracted.')
    const at = this.safeTimestamp(this.clock())
    this.repository.updateStatus(entryId, 'retracted', null, at)
    this.recordEvent('selfmodel.retracted', { ...current, status: 'retracted' }, null, {})
  }

  activeStatementsForContext(limit = 5): Array<Pick<SelfModelEntry, 'id' | 'kind' | 'statement' | 'confidence'>> {
    return this.list({ status: 'active' })
      .filter((entry) => entry.kind === 'fact' || entry.kind === 'correction')
      .slice(0, limit)
      .map(({ id, kind, statement, confidence }) => ({ id, kind, statement, confidence }))
  }

  private recordEvent(eventType: string, entry: SelfModelEntry, correlationId: string | null, payload: Record<string, unknown>): void {
    this.events?.tryRecord({
      sourceModule: 'self-model',
      eventType,
      actor: eventType === 'selfmodel.recorded' && entry.kind === 'fact' ? 'user' : 'system',
      subjectType: 'self_model_entry',
      subjectId: entry.id,
      correlationId,
      payload: { kind: entry.kind, status: entry.status, ...payload }
    })
  }

  private safeTimestamp(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Self-model timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}

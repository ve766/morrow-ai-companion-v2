import type { EventLogService } from '../persistence/event-log'
import {
  INTEREST_ARCHIVE_AFTER_DAYS,
  INTEREST_MATCH_MIN_SHARED_TERMS,
  canTransitionInterestStatus,
  computeInterestStrength,
  confidenceForEvidence,
  extractInterestTerms,
  interestPromotionEligible,
  sharedTermCount,
  type InterestEvidence,
  type InterestRecord,
  type InterestStatus
} from './self-model-domain'

export interface InterestRepositoryPort {
  all(): InterestRecord[]
  create(record: InterestRecord): void
  update(record: InterestRecord): void
}

export interface InterestObservation {
  conversationId: string
  messageId: string
  occurredAt: string
  topicText: string
}

interface InterestRow {
  id: string
  label: string
  status: string
  evidence_count: number
  conversation_count: number
  strength: number
  confidence: number
  source_message_id: string
  conversation_id: string
  first_seen_at: string
  last_seen_at: string
  updated_at: string
  terms_json: string
}

export class SqliteInterestRepository implements InterestRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  all(): InterestRecord[] {
    const rows = this.database.connection.prepare('SELECT * FROM interests ORDER BY strength DESC, last_seen_at DESC, id').all() as unknown as InterestRow[]
    return rows.map(mapInterest)
  }

  create(record: InterestRecord): void {
    this.database.connection.prepare(`
      INSERT INTO interests(id, label, status, evidence_count, conversation_count, strength, confidence, source_message_id, conversation_id, first_seen_at, last_seen_at, updated_at, terms_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.label, record.status, record.evidenceCount, record.conversationCount, record.strength, record.confidence, record.sourceMessageId, record.conversationId, record.firstSeenAt, record.lastSeenAt, record.updatedAt, JSON.stringify(record.terms))
  }

  update(record: InterestRecord): void {
    this.database.connection.prepare(`
      UPDATE interests
      SET status = ?, evidence_count = ?, conversation_count = ?, strength = ?, confidence = ?, last_seen_at = ?, updated_at = ?, terms_json = ?
      WHERE id = ?
    `).run(record.status, record.evidenceCount, record.conversationCount, record.strength, record.confidence, record.lastSeenAt, record.updatedAt, JSON.stringify(record.terms), record.id)
  }
}

function mapInterest(row: InterestRow): InterestRecord {
  return {
    id: row.id,
    label: row.label,
    status: row.status as InterestStatus,
    evidenceCount: row.evidence_count,
    conversationCount: row.conversation_count,
    strength: row.strength,
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    conversationId: row.conversation_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
    terms: parseTerms(row.terms_json)
  }
}

function parseTerms(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((term): term is string => typeof term === 'string').slice(0, 16)
  } catch {
    return []
  }
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000
}

// Interest labels are the dominant topic terms of a turn. Extraction is
// deliberately simple and deterministic: leading CJK bigrams and the longest
// latin tokens of the message. This is weak, transparent evidence — which is
// exactly why single-mention topics stay 'candidate'.
export function deriveInterestLabel(topicText: string): string | null {
  const terms = extractInterestTerms(topicText)
  if (terms.length === 0) return null
  // Prefer the longest latin token; otherwise the first non-stop CJK bigram.
  const latin = terms.filter((term) => /^[a-z]/u.test(term)).sort((left, right) => right.length - left.length)[0]
  if (latin) return latin.slice(0, 64)
  return terms.find((term) => /\p{Script=Han}/u.test(term)) ?? null
}


export class InterestService {
  constructor(
    private readonly repository: InterestRepositoryPort,
    private readonly events: EventLogService | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  list(): InterestRecord[] {
    return this.repository.all()
  }

  /** Active interests for context assembly, strongest first. */
  activeForContext(limit = 5): InterestRecord[] {
    return this.repository.all()
      .filter((record) => record.status === 'active')
      .slice(0, limit)
  }

  observe(observation: InterestObservation): InterestRecord | null {
    const label = deriveInterestLabel(observation.topicText)
    if (!label) return null
    const now = this.safeTimestamp(observation.occurredAt)
    const terms = extractInterestTerms(observation.topicText)
    // Topic identity: join the interest sharing the most extracted terms
    // (>= 2). Pure label equality is too brittle for CJK phrasings.
    const existing = this.repository.all()
      .filter((record) => record.status !== 'dropped')
      .map((record) => ({ record, shared: sharedTermCount(record.terms, terms) }))
      .filter((item) => item.shared >= INTEREST_MATCH_MIN_SHARED_TERMS)
      .sort((left, right) => right.shared - left.shared)[0]?.record
    if (!existing) {
      const created: InterestRecord = {
        id: this.makeId().toLowerCase(),
        label,
        status: 'candidate',
        evidenceCount: 1,
        conversationCount: 1,
        strength: computeInterestStrength(1, 1, 0),
        confidence: confidenceForEvidence(1, 1),
        sourceMessageId: observation.messageId,
        conversationId: observation.conversationId,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
        terms
      }
      this.repository.create(created)
      this.recordEvent('interest.observed', created, { newTopic: true })
      return created
    }

    const isNewConversation = existing.conversationId !== observation.conversationId
    const evidenceCount = existing.evidenceCount + 1
    const conversationCount = existing.conversationCount + (isNewConversation ? 1 : 0)
    const lastSeenAt = now
    const strength = computeInterestStrength(evidenceCount, conversationCount, 0)
    const confidence = confidenceForEvidence(evidenceCount, conversationCount)
    let status = existing.status
    if (status === 'archived' && isNewConversation) status = 'candidate'
    if (interestPromotionEligible({ status, conversationCount, evidenceCount })) status = 'active'
    const updated: InterestRecord = {
      ...existing,
      status,
      evidenceCount,
      conversationCount,
      strength,
      confidence,
      lastSeenAt,
      updatedAt: now,
      terms: [...new Set([...existing.terms, ...terms])].slice(0, 16)
    }
    this.repository.update(updated)
    const promoted = existing.status !== 'active' && updated.status === 'active'
    this.recordEvent(promoted ? 'interest.promoted' : 'interest.observed', updated, {
      newTopic: false,
      evidenceCount,
      conversationCount
    })
    return updated
  }

  /** Archive stale interests; called on observation and reflection runs. */
  archiveStale(now: string): number {
    const at = this.safeTimestamp(now)
    let archived = 0
    for (const record of this.repository.all()) {
      if (record.status !== 'candidate' && record.status !== 'active') continue
      if (daysBetween(record.lastSeenAt, at) <= INTEREST_ARCHIVE_AFTER_DAYS) continue
      if (!canTransitionInterestStatus(record.status, 'archived', 'system')) continue
      const updated: InterestRecord = { ...record, status: 'archived', updatedAt: at }
      this.repository.update(updated)
      this.recordEvent('interest.archived', updated, { reason: 'stale' })
      archived += 1
    }
    return archived
  }

  setUserStatus(id: string, status: InterestStatus): InterestRecord {
    const record = this.repository.all().find((item) => item.id === id)
    if (!record) throw new Error('Interest not found.')
    if (!canTransitionInterestStatus(record.status, status, 'user')) throw new Error('Interest status transition is not allowed.')
    const at = this.safeTimestamp(this.clock())
    const updated: InterestRecord = { ...record, status, updatedAt: at }
    this.repository.update(updated)
    this.recordEvent('interest.status_changed', updated, { from: record.status, to: status })
    return updated
  }

  evidenceTrail(record: InterestRecord, messageBodies: Map<string, string>): InterestEvidence[] {
    // The journal carries the per-observation events; this reconstructs the
    // human-visible evidence summary from message references.
    return [{
      messageId: record.sourceMessageId,
      conversationId: record.conversationId,
      occurredAt: record.firstSeenAt,
      excerpt: (messageBodies.get(record.sourceMessageId) ?? '').slice(0, 200)
    }]
  }

  private recordEvent(eventType: string, record: InterestRecord, payload: Record<string, unknown>): void {
    this.events?.tryRecord({
      sourceModule: 'self-model',
      eventType,
      actor: eventType === 'interest.status_changed' ? 'user' : 'system',
      subjectType: 'interest',
      subjectId: record.id,
      correlationId: record.conversationId,
      payload: { label: record.label, status: record.status, ...payload }
    })
  }

  private safeTimestamp(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Interest timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}

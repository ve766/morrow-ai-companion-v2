import { createHash, randomUUID } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import type { SqliteDatabase } from '../persistence/database'

/**
 * Feedback candidates: a record that the user may want Morrow to behave
 * differently, and the evidence for it. Nothing here changes the personality.
 *
 * `apply` is the only method that can lead to a change, it requires an explicit
 * callback that performs the save, and it refuses sensitive feedback unless the
 * caller passes consent. No timer, turn hook or background job calls it.
 */

export const FEEDBACK_KINDS = ['interaction_preference', 'tone', 'boundary', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_SOURCES = ['user_explicit', 'model_inferred'] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

export const FEEDBACK_STATUSES = ['pending', 'supported', 'rejected', 'withdrawn', 'applied'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export type FeedbackSensitivity = 'normal' | 'personal' | 'sensitive'

export interface FeedbackCandidate {
  id: string
  kind: FeedbackKind
  source: FeedbackSource
  evidenceHash: string
  evidenceExcerpt: string
  confidence: number
  sensitivity: FeedbackSensitivity
  status: FeedbackStatus
  distinctConversations: number
  decisionReason: string | null
  appliedPersonalityVersion: number | null
  createdAt: string
  updatedAt: string
}

export interface FeedbackRecordInput {
  kind: FeedbackKind
  source: FeedbackSource
  conversationId: string
  messageId?: string | null
  claim: string
  confidence: number
  sensitivity: FeedbackSensitivity
}

/** Two independent conversations is the minimum for "supported". */
export const FEEDBACK_SUPPORT_THRESHOLD = 2

interface CandidateRow {
  id: string
  kind: string
  source: string
  evidence_hash: string
  evidence_excerpt: string
  confidence: number
  sensitivity: string
  status: string
  decision_reason: string | null
  applied_personality_version: number | null
  created_at: string
  updated_at: string
}

function normalizeClaim(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

export function feedbackEvidenceHash(claim: string): string {
  return createHash('sha256').update(normalizeClaim(claim)).digest('hex')
}

function mapRow(row: CandidateRow, distinctConversations: number): FeedbackCandidate {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    source: row.source as FeedbackSource,
    evidenceHash: row.evidence_hash,
    evidenceExcerpt: row.evidence_excerpt,
    confidence: row.confidence,
    sensitivity: row.sensitivity as FeedbackSensitivity,
    status: row.status as FeedbackStatus,
    distinctConversations,
    decisionReason: row.decision_reason,
    appliedPersonalityVersion: row.applied_personality_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class FeedbackCandidateService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => randomUUID()
  ) {}

  record(input: FeedbackRecordInput): { candidate: FeedbackCandidate; created: boolean } {
    if (!FEEDBACK_KINDS.includes(input.kind)) throw new ApplicationError('INVALID_INPUT')
    if (!FEEDBACK_SOURCES.includes(input.source)) throw new ApplicationError('INVALID_INPUT')
    if (!['normal', 'personal', 'sensitive'].includes(input.sensitivity)) throw new ApplicationError('INVALID_INPUT')
    if (!Number.isSafeInteger(input.confidence) || input.confidence < 1 || input.confidence > 100) throw new ApplicationError('INVALID_INPUT')
    if (typeof input.conversationId !== 'string' || input.conversationId.length !== 36) throw new ApplicationError('INVALID_INPUT')
    if (typeof input.claim !== 'string' || input.claim.trim().length === 0 || input.claim.length > 2000) throw new ApplicationError('INVALID_INPUT')

    const now = this.timestamp()
    const hash = feedbackEvidenceHash(input.claim)
    const existing = this.getByHash(hash)
    const id = existing?.id ?? this.makeId().toLowerCase()

    if (!existing) {
      this.database.connection.prepare(`
        INSERT INTO persona_feedback_candidates(
          id, kind, source, evidence_hash, evidence_excerpt, confidence, sensitivity,
          status, decision_reason, applied_personality_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
      `).run(id, input.kind, input.source, hash, input.claim.trim().slice(0, 500), input.confidence, input.sensitivity, now, now)
    }

    // The same sentence in the same conversation is one piece of evidence. The
    // primary key makes the repeat a no-op instead of a second data point.
    this.database.connection.prepare(`
      INSERT OR IGNORE INTO persona_feedback_evidence(candidate_id, conversation_id, message_id, evidence_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.conversationId, input.messageId ?? null, hash, now)

    const distinct = this.distinctConversations(id)
    const current = this.get(id)!
    if (current.status === 'pending' && distinct >= FEEDBACK_SUPPORT_THRESHOLD) {
      this.database.connection.prepare(`
        UPDATE persona_feedback_candidates SET status = 'supported', updated_at = ? WHERE id = ?
      `).run(now, id)
    }
    return { candidate: this.get(id)!, created: existing === null }
  }

  list(status?: FeedbackStatus): FeedbackCandidate[] {
    const rows = (status
      ? this.database.connection.prepare('SELECT * FROM persona_feedback_candidates WHERE status = ? ORDER BY created_at DESC, id').all(status)
      : this.database.connection.prepare('SELECT * FROM persona_feedback_candidates ORDER BY created_at DESC, id').all()) as unknown as CandidateRow[]
    return rows.map((row) => mapRow(row, this.distinctConversations(row.id)))
  }

  get(id: string): FeedbackCandidate | null {
    const row = this.database.connection.prepare('SELECT * FROM persona_feedback_candidates WHERE id = ?').get(id) as unknown as CandidateRow | undefined
    return row ? mapRow(row, this.distinctConversations(id)) : null
  }

  reject(id: string, reason: string): FeedbackCandidate {
    return this.decide(id, 'rejected', reason, ['pending', 'supported'])
  }

  withdraw(id: string, reason: string): FeedbackCandidate {
    return this.decide(id, 'withdrawn', reason, ['pending', 'supported'])
  }

  /**
   * Applies an approved candidate. The caller performs the personality save and
   * returns the new version; this service only records that it happened. It is
   * never called from a turn hook, so a candidate cannot change the personality
   * on its own.
   */
  apply(id: string, options: { includeSensitive: boolean; apply: (candidate: FeedbackCandidate) => number }): FeedbackCandidate {
    const candidate = this.get(id)
    if (!candidate) throw new ApplicationError('NOT_FOUND')
    if (candidate.status !== 'pending' && candidate.status !== 'supported') throw new ApplicationError('CONFLICT')
    if (candidate.sensitivity === 'sensitive' && !options.includeSensitive) throw new ApplicationError('FORBIDDEN')
    const version = options.apply(candidate)
    if (!Number.isSafeInteger(version) || version < 1) throw new ApplicationError('STORAGE_ERROR')
    const now = this.timestamp()
    this.database.connection.prepare(`
      UPDATE persona_feedback_candidates
      SET status = 'applied', applied_personality_version = ?, decision_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(version, 'approved by explicit caller', now, id)
    return this.get(id)!
  }

  /** Deleting or retracting the source conversation withdraws its candidates. */
  withdrawForConversation(conversationId: string, reason: string): number {
    const rows = this.database.connection.prepare(`
      SELECT DISTINCT candidate_id FROM persona_feedback_evidence WHERE conversation_id = ?
    `).all(conversationId) as unknown as Array<{ candidate_id: string }>
    let withdrawn = 0
    for (const row of rows) {
      const candidate = this.get(row.candidate_id)
      if (!candidate || (candidate.status !== 'pending' && candidate.status !== 'supported')) continue
      this.decide(candidate.id, 'withdrawn', reason, ['pending', 'supported'])
      withdrawn += 1
    }
    return withdrawn
  }

  private decide(id: string, status: FeedbackStatus, reason: string, allowed: FeedbackStatus[]): FeedbackCandidate {
    const candidate = this.get(id)
    if (!candidate) throw new ApplicationError('NOT_FOUND')
    if (!allowed.includes(candidate.status)) throw new ApplicationError('CONFLICT')
    this.database.connection.prepare(`
      UPDATE persona_feedback_candidates SET status = ?, decision_reason = ?, updated_at = ? WHERE id = ?
    `).run(status, reason.slice(0, 500), this.timestamp(), id)
    return this.get(id)!
  }

  private getByHash(hash: string): FeedbackCandidate | null {
    const row = this.database.connection.prepare('SELECT * FROM persona_feedback_candidates WHERE evidence_hash = ?').get(hash) as unknown as CandidateRow | undefined
    return row ? mapRow(row, this.distinctConversations(row.id)) : null
  }

  private distinctConversations(id: string): number {
    const row = this.database.connection.prepare(`
      SELECT COUNT(DISTINCT conversation_id) AS count FROM persona_feedback_evidence WHERE candidate_id = ?
    `).get(id) as unknown as { count: number }
    return Number(row.count)
  }

  private timestamp(): string {
    const value = this.clock()
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new ApplicationError('STORAGE_ERROR')
    return new Date(parsed).toISOString()
  }
}

import { createHash, randomUUID } from 'node:crypto'
import { ApplicationError } from '../shared/errors'
import type { SqliteDatabase } from '../persistence/database'

/**
 * Feedback candidates: a record that the user may want Morrow to behave
 * differently, and the evidence for it. Nothing here changes the personality.
 *
 * Identity is `(evidence hash, kind)`: the same sentence can be a tone request
 * in one turn and a boundary request in another, and merging them would lose
 * the distinction. Evidence rows keep their own source, sensitivity and
 * lifecycle, so merging can never downgrade protection.
 *
 * `apply` is the only path to a personality change. It is at-most-once per
 * candidate (a unique application row), it requires an explicit caller
 * callback, and it refuses sensitive feedback without consent.
 */

export const FEEDBACK_KINDS = ['interaction_preference', 'tone', 'boundary', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_SOURCES = ['user_explicit', 'model_inferred'] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

export const FEEDBACK_STATUSES = ['pending', 'supported', 'rejected', 'withdrawn', 'applied'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export type FeedbackSensitivity = 'normal' | 'personal' | 'sensitive'
const SENSITIVITY_ORDER: readonly FeedbackSensitivity[] = ['normal', 'personal', 'sensitive']

export const APPLICATION_STATUSES = ['applying', 'applied', 'failed', 'needs_review'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

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

export interface FeedbackEvidence {
  candidateId: string
  conversationId: string
  messageId: string | null
  source: FeedbackSource
  sensitivity: FeedbackSensitivity
  status: 'active' | 'withdrawn'
  createdAt: string
  withdrawnAt: string | null
}

export interface FeedbackApplication {
  id: string
  candidateId: string
  status: ApplicationStatus
  basePersonalityVersion: number
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

interface EvidenceRow {
  candidate_id: string
  conversation_id: string
  message_id: string | null
  source: string
  sensitivity: string
  status: string
  created_at: string
  withdrawn_at: string | null
}

interface ApplicationRow {
  id: string
  candidate_id: string
  status: string
  base_personality_version: number
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

function strongerSensitivity(left: FeedbackSensitivity, right: FeedbackSensitivity): FeedbackSensitivity {
  return SENSITIVITY_ORDER.indexOf(right) > SENSITIVITY_ORDER.indexOf(left) ? right : left
}

function mapCandidate(row: CandidateRow, distinct: number): FeedbackCandidate {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    source: row.source as FeedbackSource,
    evidenceHash: row.evidence_hash,
    evidenceExcerpt: row.evidence_excerpt,
    confidence: row.confidence,
    sensitivity: row.sensitivity as FeedbackSensitivity,
    status: row.status as FeedbackStatus,
    distinctConversations: distinct,
    decisionReason: row.decision_reason,
    appliedPersonalityVersion: row.applied_personality_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapEvidence(row: EvidenceRow): FeedbackEvidence {
  return {
    candidateId: row.candidate_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    source: row.source as FeedbackSource,
    sensitivity: row.sensitivity as FeedbackSensitivity,
    status: row.status as 'active' | 'withdrawn',
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at
  }
}

function mapApplication(row: ApplicationRow): FeedbackApplication {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    status: row.status as ApplicationStatus,
    basePersonalityVersion: row.base_personality_version,
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
    const existing = this.getByIdentity(hash, input.kind)
    const id = existing?.id ?? this.makeId().toLowerCase()

    if (!existing) {
      try {
        this.database.connection.prepare(`
          INSERT INTO persona_feedback_candidates(
            id, kind, source, evidence_hash, evidence_excerpt, confidence, sensitivity,
            status, decision_reason, applied_personality_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
        `).run(id, input.kind, input.source, hash, input.claim.trim().slice(0, 500), input.confidence, input.sensitivity, now, now)
      } catch {
        // A concurrent insert won the unique index; fall through to that row.
      }
    } else {
      // Merge without losing protection: sensitivity only escalates, and a
      // user-explicit source outranks a model inference. Evidence rows keep
      // their own source, so the original attribution is never overwritten.
      const sensitivity = strongerSensitivity(existing.sensitivity, input.sensitivity)
      const source: FeedbackSource = existing.source === 'user_explicit' || input.source === 'user_explicit' ? 'user_explicit' : 'model_inferred'
      if (sensitivity !== existing.sensitivity || source !== existing.source) {
        this.database.connection.prepare(`
          UPDATE persona_feedback_candidates SET sensitivity = ?, source = ?, updated_at = ? WHERE id = ?
        `).run(sensitivity, source, now, id)
      }
    }

    // The same sentence in the same conversation is one piece of evidence. The
    // primary key makes the repeat a no-op instead of a second data point.
    this.database.connection.prepare(`
      INSERT OR IGNORE INTO persona_feedback_evidence(
        candidate_id, conversation_id, message_id, evidence_hash, source, sensitivity, status, created_at, withdrawn_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL)
    `).run(id, input.conversationId, input.messageId ?? null, hash, input.source, input.sensitivity, now)

    this.recomputeSupport(id)
    const candidate = this.get(id)
    if (!candidate) throw new ApplicationError('STORAGE_ERROR')
    return { candidate, created: existing === null }
  }

  list(status?: FeedbackStatus): FeedbackCandidate[] {
    const rows = (status
      ? this.database.connection.prepare('SELECT * FROM persona_feedback_candidates WHERE status = ? ORDER BY created_at DESC, id').all(status)
      : this.database.connection.prepare('SELECT * FROM persona_feedback_candidates ORDER BY created_at DESC, id').all()) as unknown as CandidateRow[]
    return rows.map((row) => mapCandidate(row, this.distinctConversations(row.id)))
  }

  get(id: string): FeedbackCandidate | null {
    const row = this.database.connection.prepare('SELECT * FROM persona_feedback_candidates WHERE id = ?').get(id) as unknown as CandidateRow | undefined
    return row ? mapCandidate(row, this.distinctConversations(id)) : null
  }

  listEvidence(id: string): FeedbackEvidence[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM persona_feedback_evidence WHERE candidate_id = ? ORDER BY created_at, conversation_id'
    ).all(id) as unknown as EvidenceRow[]
    return rows.map(mapEvidence)
  }

  reject(id: string, reason: string): FeedbackCandidate {
    return this.decide(id, 'rejected', reason, ['pending', 'supported'])
  }

  withdraw(id: string, reason: string): FeedbackCandidate {
    return this.decide(id, 'withdrawn', reason, ['pending', 'supported'])
  }

  /**
   * Applies an approved candidate at most once, inside one transaction.
   *
   * The personality row, the candidate status and the application record live in
   * the same SQLite database on the same connection, so the application record,
   * the personality write and the status update commit together. If anything
   * throws, the personality write is rolled back and only a `failed` record is
   * kept as an audit trail — the candidate stays supported, which is the
   * `not_applied` state.
   *
   * `baseVersion` is re-checked at write time by requiring the saved version to
   * be exactly `baseVersion + 1`, so a caller that saw an old version cannot
   * silently overwrite an intervening edit or rollback.
   */
  apply(id: string, options: { includeSensitive: boolean; baseVersion: number; currentVersion?: number; apply: (candidate: FeedbackCandidate) => number }): FeedbackCandidate {
    const candidate = this.get(id)
    if (!candidate) throw new ApplicationError('NOT_FOUND')
    if (candidate.status !== 'pending' && candidate.status !== 'supported') throw new ApplicationError('CONFLICT')
    if (candidate.sensitivity === 'sensitive' && !options.includeSensitive) throw new ApplicationError('FORBIDDEN')
    if (!Number.isSafeInteger(options.baseVersion) || options.baseVersion < 1) throw new ApplicationError('INVALID_INPUT')
    if (options.currentVersion !== undefined && options.baseVersion !== options.currentVersion) throw new ApplicationError('CONFLICT')

    const applicationId = this.makeId().toLowerCase()
    try {
      return this.database.transaction(() => {
        // Re-read inside the transaction: a concurrent caller may have applied or
        // withdrawn the candidate between the preflight check and this point.
        const current = this.get(id)
        if (!current) throw new ApplicationError('NOT_FOUND')
        if (current.status !== 'pending' && current.status !== 'supported') throw new ApplicationError('CONFLICT')
        if (current.sensitivity === 'sensitive' && !options.includeSensitive) throw new ApplicationError('FORBIDDEN')
        if (this.applicationFor(id)) throw new ApplicationError('CONFLICT')
        const now = this.timestamp()
        this.database.connection.prepare(`
          INSERT INTO persona_feedback_applications(id, candidate_id, status, base_personality_version, applied_personality_version, created_at, updated_at)
          VALUES (?, ?, 'applying', ?, NULL, ?, ?)
        `).run(applicationId, id, options.baseVersion, now, now)

        const version = options.apply(current)
        if (!Number.isSafeInteger(version) || version < 1) throw new ApplicationError('STORAGE_ERROR')
        if (version !== options.baseVersion + 1) throw new ApplicationError('CONFLICT')

        const appliedAt = this.timestamp()
        this.database.connection.prepare(`
          UPDATE persona_feedback_applications
          SET status = 'applied', applied_personality_version = ?, updated_at = ? WHERE id = ?
        `).run(version, appliedAt, applicationId)
        this.database.connection.prepare(`
          UPDATE persona_feedback_candidates
          SET status = 'applied', applied_personality_version = ?, decision_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(version, 'approved by explicit caller', appliedAt, id)
        return this.get(id)!
      })
    } catch (error) {
      this.recordFailedApplication(applicationId, id, options.baseVersion, error)
      throw error
    }
  }

  /** Best effort: the failure record must never mask the original error. */
  private recordFailedApplication(applicationId: string, candidateId: string, baseVersion: number, error: unknown): void {
    try {
      // An existing row means an earlier attempt (possibly a crashed `applying`
      // one) owns the audit trail; overwriting it would hide the unknown result.
      const existing = this.database.connection.prepare('SELECT id FROM persona_feedback_applications WHERE candidate_id = ?')
        .get(candidateId)
      if (existing) return
      const now = this.timestamp()
      const detail = error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
      this.database.connection.prepare(`
        INSERT INTO persona_feedback_applications(id, candidate_id, status, base_personality_version, applied_personality_version, created_at, updated_at)
        VALUES (?, ?, 'failed', ?, NULL, ?, ?)
      `).run(applicationId, candidateId, baseVersion, now, now)
      this.database.connection.prepare(`
        UPDATE persona_feedback_candidates SET decision_reason = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'supported')
      `).run(`application failed: ${detail}`, now, candidateId)
    } catch {
      // Losing the audit row is acceptable; losing the caller's error is not.
    }
  }

  applicationFor(candidateId: string): FeedbackApplication | null {
    const row = this.database.connection.prepare(
      'SELECT * FROM persona_feedback_applications WHERE candidate_id = ?'
    ).get(candidateId) as unknown as ApplicationRow | undefined
    return row ? mapApplication(row) : null
  }

  /**
   * An `applying` row means the process may have died between the personality
   * save and the status update. We cannot tell whether the save happened, so we
   * mark it for review and never retry automatically.
   */
  recoverInterruptedApplications(): number {
    const rows = this.database.connection.prepare(
      "SELECT id FROM persona_feedback_applications WHERE status = 'applying'"
    ).all() as unknown as Array<{ id: string }>
    for (const row of rows) {
      this.database.connection.prepare(`
        UPDATE persona_feedback_applications SET status = 'needs_review', updated_at = ? WHERE id = ?
      `).run(this.timestamp(), row.id)
    }
    return rows.length
  }

  /** Conversation deletion withdraws its evidence, then recomputes support. */
  withdrawForConversation(conversationId: string, reason: string): number {
    return this.withdrawEvidence(
      'SELECT DISTINCT candidate_id FROM persona_feedback_evidence WHERE conversation_id = ? AND status = \'active\'',
      conversationId,
      reason,
      'conversation_id'
    )
  }

  /** Message deletion withdraws only that message's evidence. */
  withdrawEvidenceForMessage(messageId: string, reason: string): number {
    return this.withdrawEvidence(
      'SELECT DISTINCT candidate_id FROM persona_feedback_evidence WHERE message_id = ? AND status = \'active\'',
      messageId,
      reason,
      'message_id'
    )
  }

  private withdrawEvidence(query: string, value: string, reason: string, column: 'conversation_id' | 'message_id'): number {
    const rows = this.database.connection.prepare(query).all(value) as unknown as Array<{ candidate_id: string }>
    if (rows.length === 0) return 0
    const now = this.timestamp()
    this.database.transaction(() => {
      this.database.connection.prepare(`
        UPDATE persona_feedback_evidence
        SET status = 'withdrawn', withdrawn_at = ?
        WHERE ${column} = ? AND status = 'active'
      `).run(now, value)
      for (const row of rows) {
        this.database.connection.prepare(`
          UPDATE persona_feedback_candidates SET decision_reason = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'supported')
        `).run(reason.slice(0, 500), now, row.candidate_id)
      }
    })
    for (const row of rows) this.recomputeSupport(row.candidate_id)
    return rows.length
  }

  private recomputeSupport(id: string): void {
    const candidate = this.get(id)
    if (!candidate) return
    if (candidate.status !== 'pending' && candidate.status !== 'supported') return
    const distinct = candidate.distinctConversations
    const next: FeedbackStatus = distinct === 0 ? 'withdrawn' : distinct >= FEEDBACK_SUPPORT_THRESHOLD ? 'supported' : 'pending'
    if (next !== candidate.status) {
      if (next === 'withdrawn') {
        // The excerpt is the only copy of the user's words in this table; once
        // the candidate has no live evidence it must not survive as text.
        this.database.connection.prepare(`
          UPDATE persona_feedback_candidates SET status = ?, evidence_excerpt = '[withdrawn]', updated_at = ? WHERE id = ?
        `).run(next, this.timestamp(), id)
      } else {
        this.database.connection.prepare('UPDATE persona_feedback_candidates SET status = ?, updated_at = ? WHERE id = ?')
          .run(next, this.timestamp(), id)
      }
    }
  }

  private decide(id: string, status: FeedbackStatus, reason: string, allowed: FeedbackStatus[]): FeedbackCandidate {
    const candidate = this.get(id)
    if (!candidate) throw new ApplicationError('NOT_FOUND')
    if (!allowed.includes(candidate.status)) throw new ApplicationError('CONFLICT')
    // Withdrawing is also a content deletion: keep the decision and the audit
    // fields, drop the user's words.
    const excerpt = status === 'withdrawn' ? "'[withdrawn]'" : 'evidence_excerpt'
    this.database.connection.prepare(`
      UPDATE persona_feedback_candidates SET status = ?, decision_reason = ?, evidence_excerpt = ${excerpt}, updated_at = ? WHERE id = ?
    `).run(status, reason.slice(0, 500), this.timestamp(), id)
    return this.get(id)!
  }

  private getByIdentity(hash: string, kind: FeedbackKind): FeedbackCandidate | null {
    const row = this.database.connection.prepare(
      'SELECT * FROM persona_feedback_candidates WHERE evidence_hash = ? AND kind = ?'
    ).get(hash, kind) as unknown as CandidateRow | undefined
    return row ? mapCandidate(row, this.distinctConversations(row.id)) : null
  }

  private distinctConversations(id: string): number {
    const row = this.database.connection.prepare(`
      SELECT COUNT(DISTINCT conversation_id) AS count FROM persona_feedback_evidence
      WHERE candidate_id = ? AND status = 'active'
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

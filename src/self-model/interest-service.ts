import type { EventLogService } from '../persistence/event-log'
import {
  INTEREST_ARCHIVE_AFTER_DAYS,
  canTransitionInterestStatus,
  computeInterestStrength,
  confidenceForEvidence,
  extractInterestTerms,
  interestPromotionEligible,
  type InterestEvidence,
  type InterestRecord,
  type InterestStatus
} from './self-model-domain'
import {
  buildTopicProfile,
  longestContentPhrase,
  mergeTopicProfiles,
  parseTopicProfile,
  scoreTopicProfiles,
  type TopicMatch,
  type TopicProfile
} from './topic-identity'

/** One observation behind an interest. The ledger, not the counter, is the truth. */
export interface InterestEvidenceRow {
  interestId: string
  /** Message id, memory id, or a synthetic id for rows migrated from the old aggregate. */
  ref: string
  kind: 'message' | 'memory' | 'legacy'
  conversationId: string
  polarity: 'support' | 'counter'
  score: number
  reason: string
  createdAt: string
}

export interface InterestEvidenceCounts {
  support: number
  conversations: number
  counter: number
}

export interface InterestRepositoryPort {
  all(): InterestRecord[]
  create(record: InterestRecord): void
  update(record: InterestRecord): void
  delete(interestId: string): void
  /** Returns false when this observation was already attributed (replay). */
  insertEvidence(row: InterestEvidenceRow): boolean
  evidenceFor(interestId: string): InterestEvidenceRow[]
  findEvidenceRef(ref: string): InterestEvidenceRow | null
  fold(interestId: string): InterestEvidenceCounts
  transaction?<T>(operation: () => T): T
}

export interface InterestObservation {
  conversationId: string
  /** Idempotency key. A message id for chat turns, a memory id for reflection. */
  messageId: string
  occurredAt: string
  topicText: string
  /** Defaults to 'message'; reflection passes 'memory'. */
  evidenceKind?: 'message' | 'memory'
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
  profile_json: string
}

interface EvidenceSqlRow {
  interest_id: string
  evidence_ref: string
  evidence_kind: string
  conversation_id: string
  polarity: string
  match_score: number
  match_reason: string
  created_at: string
}

export class SqliteInterestRepository implements InterestRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  all(): InterestRecord[] {
    const rows = this.database.connection.prepare('SELECT * FROM interests ORDER BY strength DESC, last_seen_at DESC, id').all() as unknown as InterestRow[]
    return rows.map(mapInterest)
  }

  create(record: InterestRecord): void {
    this.database.connection.prepare(`
      INSERT INTO interests(id, label, status, evidence_count, conversation_count, strength, confidence, source_message_id, conversation_id, first_seen_at, last_seen_at, updated_at, terms_json, profile_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.label, record.status, record.evidenceCount, record.conversationCount, record.strength, record.confidence, record.sourceMessageId, record.conversationId, record.firstSeenAt, record.lastSeenAt, record.updatedAt, JSON.stringify(record.terms), JSON.stringify(record.profile ?? null))
  }

  update(record: InterestRecord): void {
    this.database.connection.prepare(`
      UPDATE interests
      SET status = ?, evidence_count = ?, conversation_count = ?, strength = ?, confidence = ?, last_seen_at = ?, updated_at = ?, terms_json = ?, profile_json = ?
      WHERE id = ?
    `).run(record.status, record.evidenceCount, record.conversationCount, record.strength, record.confidence, record.lastSeenAt, record.updatedAt, JSON.stringify(record.terms), JSON.stringify(record.profile ?? null), record.id)
  }

  delete(interestId: string): void {
    this.database.connection.prepare('DELETE FROM interest_evidence WHERE interest_id = ?').run(interestId)
    this.database.connection.prepare('DELETE FROM interests WHERE id = ?').run(interestId)
  }

  insertEvidence(row: InterestEvidenceRow): boolean {
    const result = this.database.connection.prepare(`
      INSERT OR IGNORE INTO interest_evidence(interest_id, evidence_ref, evidence_kind, conversation_id, polarity, match_score, match_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.interestId, row.ref, row.kind, row.conversationId, row.polarity, row.score, row.reason, row.createdAt)
    return Number(result.changes) > 0
  }

  evidenceFor(interestId: string): InterestEvidenceRow[] {
    const rows = this.database.connection.prepare(
      'SELECT * FROM interest_evidence WHERE interest_id = ? ORDER BY created_at, evidence_ref'
    ).all(interestId) as unknown as EvidenceSqlRow[]
    return rows.map(mapEvidence)
  }

  findEvidenceRef(ref: string): InterestEvidenceRow | null {
    const row = this.database.connection.prepare('SELECT * FROM interest_evidence WHERE evidence_ref = ?').get(ref) as unknown as EvidenceSqlRow | undefined
    return row ? mapEvidence(row) : null
  }

  fold(interestId: string): InterestEvidenceCounts {
    const row = this.database.connection.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN polarity = 'support' THEN 1 ELSE 0 END), 0) AS support,
        COUNT(DISTINCT CASE WHEN polarity = 'support' THEN conversation_id END) AS conversations,
        COALESCE(SUM(CASE WHEN polarity = 'counter' THEN 1 ELSE 0 END), 0) AS counter
      FROM interest_evidence WHERE interest_id = ?
    `).get(interestId) as { support: number; conversations: number; counter: number }
    return { support: Number(row.support), conversations: Number(row.conversations), counter: Number(row.counter) }
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)
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
    terms: parseTerms(row.terms_json),
    profile: parseTopicProfile(safeParse(row.profile_json))
  }
}

function mapEvidence(row: EvidenceSqlRow): InterestEvidenceRow {
  return {
    interestId: row.interest_id,
    ref: row.evidence_ref,
    kind: row.evidence_kind as InterestEvidenceRow['kind'],
    conversationId: row.conversation_id,
    polarity: row.polarity as InterestEvidenceRow['polarity'],
    score: row.match_score,
    reason: row.match_reason,
    createdAt: row.created_at
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseTerms(text: string): string[] {
  const parsed = safeParse(text)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((term): term is string => typeof term === 'string').slice(0, 16)
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000
}

// Interest labels are the most specific content phrase of a turn. The old rule
// took the first content bigram, which labelled "我最近在学咖啡拉花" as "最近" and
// let two unrelated topics collide on the unique label index. Deterministic and
// transparent on purpose — this is weak evidence, which is why a single mention
// never leaves 'candidate'.
export function deriveInterestLabel(topicText: string): string | null {
  const profile = buildTopicProfile(topicText)
  const phrase = longestContentPhrase(profile)
  if (phrase && phrase.length >= 2) return phrase.slice(0, 64)
  const latin = profile.preferred
    .filter((term) => /^[a-z][a-z0-9'-]*$/u.test(term))
    .sort((left, right) => right.length - left.length)[0]
  if (latin) return latin.slice(0, 64)
  return profile.preferred[0]?.slice(0, 64) ?? null
}

export class InterestService {
  constructor(
    private readonly repository: InterestRepositoryPort,
    private readonly events: EventLogService | undefined,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID()
  ) {}

  /**
   * Reads go through `reconcile`, because the aggregates are a cache over the
   * evidence ledger. Deleting a message removes its evidence through a SQL
   * trigger, and the next read has to reflect that: the cached counters are
   * repaired and the interest loses `active` when the remaining evidence no
   * longer meets the promotion threshold.
   */
  list(): InterestRecord[] {
    const reconciled: InterestRecord[] = []
    for (const record of this.repository.all()) {
      const next = this.reconcile(record)
      if (next) reconciled.push(next)
    }
    return reconciled.sort((left, right) => right.strength - left.strength || right.lastSeenAt.localeCompare(left.lastSeenAt))
  }

  /** Active interests for context assembly, strongest first. */
  activeForContext(limit = 5): InterestRecord[] {
    return this.list()
      .filter((record) => record.status === 'active')
      .slice(0, limit)
  }

  observe(observation: InterestObservation): InterestRecord | null {
    const run = this.repository.transaction
      ? this.repository.transaction.bind(this.repository)
      : <T>(operation: () => T): T => operation()
    return run(() => this.observeInner(observation))
  }

  private observeInner(observation: InterestObservation): InterestRecord | null {
    const label = deriveInterestLabel(observation.topicText)
    if (!label) return null
    const now = this.safeTimestamp(observation.occurredAt)

    // Idempotency: one observation contributes once, no matter how often the
    // turn is replayed or how many times reflection re-reads the same memory.
    const alreadyRecorded = this.repository.findEvidenceRef(observation.messageId)
    if (alreadyRecorded) {
      const existing = this.repository.all().find((record) => record.id === alreadyRecorded.interestId)
      return existing ? this.reconcile(existing) : null
    }

    const kind = observation.evidenceKind ?? 'message'
    const profile = buildTopicProfile(observation.topicText)
    const terms = extractInterestTerms(observation.topicText)
    const candidates = this.repository.all()
      .filter((record) => record.status !== 'dropped')
      .map((record) => ({ record, match: scoreTopicProfiles(this.profileOf(record), profile) }))
      .sort((left, right) => right.match.score - left.match.score)
    const best = candidates[0]

    // Opposite polarity against an existing topic is recorded as counter
    // evidence. It is deliberately not counted as support: "我不想再练了" must
    // not make the interest stronger. This is checked before the "negated with
    // no topic" branch, otherwise a reversal could never reach its own topic.
    const reversesExisting = best !== undefined &&
      (best.match.reason === 'polarity_conflict' || (profile.negated && best.match.decision === 'same'))

    // A negated first mention is not evidence of interest. It is not evidence
    // of disinterest either (there was nothing to reverse), so it is dropped
    // with an explicit event instead of quietly creating a candidate.
    if (profile.negated && !reversesExisting) {
      this.events?.tryRecord({
        sourceModule: 'self-model',
        eventType: 'interest.negative_mention_ignored',
        actor: 'system',
        subjectType: 'interest',
        subjectId: observation.messageId,
        correlationId: observation.conversationId,
        payload: { reason: 'negated_without_existing_topic' }
      })
      return null
    }

    if (best && reversesExisting) {
      const inserted = this.repository.insertEvidence({
        interestId: best.record.id,
        ref: observation.messageId,
        kind,
        conversationId: observation.conversationId,
        polarity: 'counter',
        score: best.match.score,
        reason: 'polarity_conflict',
        createdAt: now
      })
      if (!inserted) return this.reconcile(best.record)
      const next = this.reconcile(best.record)
      this.recordEvent('interest.counter_evidence', best.record, {
        ref: observation.messageId,
        score: best.match.score,
        counter: this.repository.fold(best.record.id).counter
      })
      return next
    }

    if (best && best.match.decision === 'same') {
      return this.applySupport(best.record, observation, kind, profile, terms, best.match, now)
    }

    // The label index is unique. Two genuinely different topics can still
    // reduce to the same phrase, and a constraint violation here would abort
    // the whole turn's cognitive update, so the label gets a stable suffix
    // instead of throwing.
    const uniqueLabel = this.uniqueLabel(label)
    const created: InterestRecord = {
      id: this.makeId().toLowerCase(),
      label: uniqueLabel,
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
      terms,
      profile
    }
    this.repository.create(created)
    this.repository.insertEvidence({
      interestId: created.id,
      ref: observation.messageId,
      kind,
      conversationId: observation.conversationId,
      polarity: 'support',
      score: best?.match.score ?? 0,
      reason: best ? best.match.reason : 'new_topic',
      createdAt: now
    })
    this.recordEvent('interest.observed', created, {
      newTopic: true,
      // The nearest existing topic and why it was not merged. Without this the
      // audit trail cannot tell "nothing similar existed" from "similar but
      // ambiguous, deliberately kept apart".
      nearestScore: best?.match.score ?? null,
      nearestReason: best?.match.reason ?? null,
      ambiguous: best?.match.decision === 'ambiguous'
    })
    return created
  }

  private applySupport(
    existing: InterestRecord,
    observation: InterestObservation,
    kind: 'message' | 'memory',
    profile: TopicProfile,
    terms: string[],
    match: TopicMatch,
    now: string
  ): InterestRecord {
    const inserted = this.repository.insertEvidence({
      interestId: existing.id,
      ref: observation.messageId,
      kind,
      conversationId: observation.conversationId,
      polarity: 'support',
      score: match.score,
      reason: match.reason,
      createdAt: now
    })
    // A replay of the same observation must not move anything.
    if (!inserted) return this.reconcile(existing) ?? existing
    const folded = this.repository.fold(existing.id)
    const merged: InterestRecord = {
      ...existing,
      evidenceCount: Math.max(1, folded.support),
      conversationCount: Math.max(1, folded.conversations),
      strength: computeInterestStrength(folded.support, folded.conversations, 0),
      confidence: confidenceForEvidence(folded.support, folded.conversations),
      lastSeenAt: now,
      updatedAt: now,
      terms: [...new Set([...existing.terms, ...terms])].slice(0, 16),
      profile: mergeTopicProfiles(this.profileOf(existing), profile)
    }
    // A returning topic that was archived becomes a candidate again, and a
    // candidate only becomes active through the documented threshold.
    let status = merged.status
    if (status === 'archived' && existing.conversationId !== observation.conversationId) status = 'candidate'
    if (interestPromotionEligible({ status, conversationCount: merged.conversationCount, evidenceCount: merged.evidenceCount })) status = 'active'
    const updated: InterestRecord = { ...merged, status }
    this.repository.update(updated)
    const promoted = existing.status !== 'active' && updated.status === 'active'
    this.recordEvent(promoted ? 'interest.promoted' : 'interest.observed', updated, {
      newTopic: false,
      evidenceCount: updated.evidenceCount,
      conversationCount: updated.conversationCount,
      matchScore: match.score,
      matchReason: match.reason
    })
    return updated
  }

  /**
   * Rebuilds the cached aggregates from the evidence ledger and repairs the row
   * when they disagree. Returns null when the interest has no supporting
   * evidence left, in which case the row is removed — a retracted observation
   * must not keep an interest alive in the next prompt.
   */
  private reconcile(record: InterestRecord): InterestRecord | null {
    const folded = this.repository.fold(record.id)
    if (folded.support === 0) {
      this.repository.delete(record.id)
      this.recordEvent('interest.retracted', record, { reason: 'no_supporting_evidence', counter: folded.counter })
      return null
    }
    const evidenceCount = folded.support
    const conversationCount = Math.max(1, folded.conversations)
    const strength = computeInterestStrength(evidenceCount, conversationCount, 0)
    const confidence = confidenceForEvidence(evidenceCount, conversationCount)
    const status = this.derivedStatus(record.status, conversationCount, evidenceCount)

    if (record.evidenceCount === evidenceCount && record.conversationCount === conversationCount &&
      record.status === status && Math.abs(record.strength - strength) < 0.0005 && record.confidence === confidence) {
      return record
    }
    const repaired: InterestRecord = { ...record, evidenceCount, conversationCount, strength, confidence, status, updatedAt: this.safeTimestamp(this.clock()) }
    this.repository.update(repaired)
    if (record.status !== status) {
      this.recordEvent('interest.recomputed', repaired, {
        from: record.status,
        to: status,
        evidenceCount,
        conversationCount,
        reason: 'evidence_recount'
      })
    }
    return repaired
  }

  private derivedStatus(current: InterestStatus, conversationCount: number, evidenceCount: number): InterestStatus {
    if (current === 'dropped') return 'dropped'
    if (current === 'archived') return 'archived'
    if (interestPromotionEligible({ status: 'candidate', conversationCount, evidenceCount })) return 'active'
    // Demotion is intentional: when supporting evidence is retracted the
    // interest must fall back to a candidate instead of keeping 'active' on
    // evidence that no longer exists.
    return 'candidate'
  }

  /** Deterministic profile for records written before profiles were stored. */
  private profileOf(record: InterestRecord): TopicProfile {
    if (record.profile) return record.profile
    // Legacy rows only kept a term set. Treating the terms as the whole profile
    // keeps them matchable without inventing text that was never stored.
    return { unigrams: record.terms, bigrams: record.terms, preferred: record.terms, negated: false }
  }

  /** Archive stale interests; called on observation and reflection runs. */
  archiveStale(now: string): number {
    const at = this.safeTimestamp(now)
    let archived = 0
    for (const record of this.list()) {
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
    const record = this.list().find((item) => item.id === id)
    if (!record) throw new Error('Interest not found.')
    if (!canTransitionInterestStatus(record.status, status, 'user')) throw new Error('Interest status transition is not allowed.')
    const at = this.safeTimestamp(this.clock())
    const updated: InterestRecord = { ...record, status, updatedAt: at }
    this.repository.update(updated)
    this.recordEvent('interest.status_changed', updated, { from: record.status, to: status })
    return updated
  }

  /**
   * Human-visible evidence. The ledger is the trail; excerpts are resolved only
   * for refs that are real messages. Memory and migrated-legacy refs keep their
   * reference without inventing text.
   */
  evidenceTrail(record: InterestRecord, messageBodies: Map<string, string>): InterestEvidence[] {
    return this.repository.evidenceFor(record.id)
      .filter((row) => row.polarity === 'support')
      .map((row) => ({
        messageId: row.ref,
        conversationId: row.conversationId,
        occurredAt: row.createdAt,
        excerpt: (messageBodies.get(row.ref) ?? '').slice(0, 200)
      }))
  }

  /** Full ledger for audits: support and counter evidence with the match reason. */
  evidenceLedger(interestId: string): InterestEvidenceRow[] {
    return this.repository.evidenceFor(interestId)
  }

  private uniqueLabel(base: string): string {
    const taken = new Set(this.repository.all().map((record) => record.label.toLocaleLowerCase()))
    if (!taken.has(base.toLocaleLowerCase())) return base
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const marker = `·${suffix}`
      const candidate = `${base.slice(0, 64 - marker.length)}${marker}`
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate
    }
    throw new Error('Interest label space is exhausted.')
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

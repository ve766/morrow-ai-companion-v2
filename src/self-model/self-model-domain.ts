export const INTEREST_STATUS_VALUES = ['candidate', 'active', 'archived', 'dropped'] as const
export type InterestStatus = (typeof INTEREST_STATUS_VALUES)[number]

/**
 * Whose interest a row describes.
 *
 * `user`   — the user kept returning to the topic.
 * `morrow` — Morrow chose to pursue it from her own reflection or unresolved
 *            questions. It is never inferred from how often the user talks.
 * `shared` — both have independent evidence for the same topic.
 */
export const INTEREST_ORIGINS = ['user', 'morrow', 'shared'] as const
export type InterestOrigin = (typeof INTEREST_ORIGINS)[number]

export const SELF_MODEL_KINDS = ['fact', 'inference', 'unknown', 'correction'] as const
export type SelfModelKind = (typeof SELF_MODEL_KINDS)[number]

export const SELF_MODEL_STATUS_VALUES = ['active', 'superseded', 'retracted'] as const
export type SelfModelStatus = (typeof SELF_MODEL_STATUS_VALUES)[number]

export const REFLECTION_FINDING_KINDS = [
  'memory_gap',
  'open_question',
  'bias_hint',
  'interest_candidate',
  'consistency_note',
  // "You read that wrong": the user corrected the assistant's understanding, not
  // a stored fact.
  'intent_correction',
  // A bounded suggestion for the next turn, derived from repeated feedback.
  'next_turn_suggestion',
  // A question Morrow formed herself, from her own repeated failure to ground
  // an answer. Not "the user talks about this" — the evidence is her own gaps.
  'morrow_interest_candidate'
] as const
export type ReflectionFindingKind = (typeof REFLECTION_FINDING_KINDS)[number]

export const REFLECTION_TRIGGERS = ['manual', 'startup', 'post_conversation'] as const
export type ReflectionTrigger = (typeof REFLECTION_TRIGGERS)[number]

export interface InterestRecord {
  id: string
  label: string
  status: InterestStatus
  /** Whose interest this is; never inferred from the other party's evidence. */
  origin: InterestOrigin
  evidenceCount: number
  conversationCount: number
  strength: number
  confidence: number
  sourceMessageId: string
  conversationId: string
  firstSeenAt: string
  lastSeenAt: string
  updatedAt: string
  /**
   * Set by a trigger when the evidence ledger changed under this aggregate
   * (message deleted, memory retracted, conversation removed). A stale row must
   * be recomputed before it may reach a prompt: the cached counters are a
   * projection, the ledger is the fact.
   */
  staleAt?: string | null
  /** Deterministic term set (CJK bigrams / latin tokens) from observed texts; used for topic identity. */
  terms: string[]
  /**
   * Stored topic profile used by the identity matcher (see `topic-identity.ts`).
   * Absent on rows written before profiles were persisted; those fall back to
   * matching on `terms` alone.
   */
  profile?: import('./topic-identity').TopicProfile | null
}

const INTEREST_STOP_CHARACTERS = new Set(['我', '的', '了', '着', '很', '真', '在', '是', '有', '和', '就', '都', '也', '不', '这', '那', '你', '他', '她', '它', '吧', '呢', '吗', '啊', '想', '下', '对', '又', '还', '再', '上', '中'])

// Deterministic term extraction for topic identity: CJK character bigrams
// (skipping stop-character-touching ones first) plus latin tokens, capped to
// keep payloads small. Evidence stays weak on purpose — promotion requires
// multiple independent conversations, not a clever classifier.
export function extractInterestTerms(text: string, limit = 16): string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const terms: string[] = []
  const latin = normalized.match(/[a-z][a-z0-9-]{2,}/gu) ?? []
  for (const token of latin) {
    if (!terms.includes(token)) terms.push(token)
  }
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const characters = Array.from(run)
    for (let index = 0; index < characters.length - 1; index += 1) {
      const bigram = characters[index]! + characters[index + 1]!
      terms.push(bigram)
    }
  }
  const preferred = terms.filter((term) => !Array.from(term).some((character) => INTEREST_STOP_CHARACTERS.has(character)))
  const ordered = [...new Set([...preferred, ...terms])]
  return ordered.slice(0, limit)
}

export function sharedTermCount(left: string[], right: string[]): number {
  const rightSet = new Set(right)
  let shared = 0
  for (const term of left) if (rightSet.has(term)) shared += 1
  return shared
}

/** Two topics are the same interest when at least two extracted terms agree. */
export const INTEREST_MATCH_MIN_SHARED_TERMS = 2

export interface InterestEvidence {
  messageId: string
  conversationId: string
  occurredAt: string
  excerpt: string
}

export interface SelfModelEntry {
  id: string
  kind: SelfModelKind
  statement: string
  status: SelfModelStatus
  confidence: number
  sourceMessageId: string | null
  conversationId: string | null
  supersededBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ReflectionFinding {
  id: string
  runId: string
  kind: ReflectionFindingKind
  statement: string
  confidence: number
  evidence: Array<{ kind: string; id: string }>
  createdAt: string
  /**
   * Identity of the finding (kind + normalised statement + evidence set).
   * A second run over the same evidence must not add a second row or a second
   * effect, so the key is unique in the schema.
   */
  dedupeKey?: string
}

/**
 * A personality proposal parked by reflection.
 *
 * The stable baseline is never moved by background work: this row carries the
 * evidence, confidence and an expiry, and stays `pending` until a user
 * confirmation consumes it. Nothing in the app applies it automatically.
 */
export interface PendingPersonalityCandidate {
  id: string
  findingId: string
  dimension: 'exploration' | 'depth' | 'pace'
  direction: 'increase' | 'decrease'
  confidence: number
  evidence: Array<{ kind: string; id: string }>
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  createdAt: string
  expiresAt: string
}

export interface ReflectionRunSummary {
  id: string
  trigger: ReflectionTrigger
  startedAt: string
  finishedAt: string
  examinedTurns: number
  examinedEvents: number
  findingsCount: number
  status: 'completed' | 'failed'
}

// Interest lifecycle thresholds: a topic seen in a single conversation never
// promotes past 'candidate', no matter how many repeats — one burst of
// enthusiasm must not become a stable interest.
export const INTEREST_PROMOTION_MIN_CONVERSATIONS = 2
export const INTEREST_PROMOTION_MIN_EVIDENCE = 3
// An interest unseen for this long is archived automatically the next time
// the service observes activity; the user can revive or drop it explicitly.
export const INTEREST_ARCHIVE_AFTER_DAYS = 30

export function canTransitionInterestStatus(from: InterestStatus, to: InterestStatus, actor: 'system' | 'user'): boolean {
  if (from === to) return false
  if (from === 'dropped') return false
  if (actor === 'system') return (from === 'candidate' || from === 'active') && to === 'archived'
  return true
}

export function interestPromotionEligible(record: Pick<InterestRecord, 'status' | 'conversationCount' | 'evidenceCount'>): boolean {
  return record.status === 'candidate' &&
    record.conversationCount >= INTEREST_PROMOTION_MIN_CONVERSATIONS &&
    record.evidenceCount >= INTEREST_PROMOTION_MIN_EVIDENCE
}

// Strength grows with evidence and with independent conversations (the
// second conversation counts far more than the third repeat of the same
// one), plus a recency term that decays with a 14-day half-life.
export function computeInterestStrength(evidenceCount: number, conversationCount: number, daysSinceLastSeen: number): number {
  const evidenceTerm = 0.2 * Math.log2(1 + Math.max(0, evidenceCount))
  const conversationTerm = 0.25 * Math.log2(1 + Math.max(0, conversationCount - 1))
  const recencyTerm = 0.3 * Math.pow(0.5, Math.max(0, daysSinceLastSeen) / 14)
  return Math.min(1, Math.round((evidenceTerm + conversationTerm + recencyTerm) * 1000) / 1000)
}

export function confidenceForEvidence(evidenceCount: number, conversationCount: number): number {
  // Bounded, monotone confidence: never above 80 until multiple independent
  // conversations agree, reflecting that rule-based topic grouping is weak
  // evidence on its own.
  const base = 30 + 8 * Math.min(evidenceCount, 6) + 6 * Math.min(conversationCount, 4)
  return Math.min(conversationCount >= 2 ? 80 : 55, base)
}

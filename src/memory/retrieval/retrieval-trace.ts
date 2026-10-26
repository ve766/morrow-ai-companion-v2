import type { Sensitivity } from '../../shared/companion'
import type { RetrievalAlgorithmId } from './retrieval-config'

// Structured, auditable record of a single retrieval decision.
//
// Deliberately contains no memory text and no query text: only ids, counts,
// numeric factors and reason codes. That keeps the trace safe to store next to
// the existing event journal and lets a reviewer answer "why these memories?"
// without duplicating private conversation content into logs.

export type RetrievalExclusionReason =
  | 'retracted'
  | 'sensitivity'
  | 'irrelevant'
  | 'superseded_statement'
  | 'duplicate'
  | 'memory_limit'
  | 'context_budget'

export const RETRIEVAL_EXCLUSION_REASONS: readonly RetrievalExclusionReason[] = [
  'retracted', 'sensitivity', 'irrelevant', 'superseded_statement', 'duplicate', 'memory_limit', 'context_budget'
]

export interface RetrievalFactors {
  /** Raw lexical overlap count (shared by both algorithms). */
  lexical: number
  /** Normalized confidence contribution, 0..1. */
  confidence: number
  /** Normalized provenance quality, 0..1. */
  provenance: number
  /** Normalized confirmation signal, 0..1. */
  confirmation: number
  /** Normalized decayed freshness, 0..1. */
  recency: number
  /** Extra freshness weight earned on a time-sensitive turn, 0..1. */
  timeSensitivity: number
  /** Near-duplicate penalty applied, 0..1. */
  duplicate: number
  /** Topic-diversity penalty applied, 0..1. */
  diversity: number
  /** Correction-chain ambiguity penalty applied, 0..1. */
  correction: number
}

export interface RetrievalCandidateTrace {
  memoryId: string
  included: boolean
  /** Position in the final selection, 1-based; null when excluded. */
  rank: number | null
  exclusionReason: RetrievalExclusionReason | null
  factors: RetrievalFactors
  /**
   * Ranking value used for ordering. Its scale is algorithm-specific:
   * v1 uses its historical `lexical + confidence/50 + recency` sum, v2 uses a
   * weighted 0..1 blend minus penalties. Never compare the number across
   * algorithms; compare the resulting order.
   */
  finalScore: number
}

export interface RetrievalDecision {
  algorithm: RetrievalAlgorithmId
  configVersion: string
  evaluatedAt: string
  maximumSensitivity: Sensitivity
  /** Records handed to the algorithm before any filtering. */
  considered: number
  /** Records that survived permission/validity filtering. */
  eligible: number
  selectedIds: string[]
  omitted: number
  characterCount: number
  memoryBudget: number
  contextBudget: number
  exclusionCounts: Record<RetrievalExclusionReason, number>
  /** How much of the cross-record correction chain was actually available. */
  correctionChain: { statements: number; truncated: boolean }
  candidates: RetrievalCandidateTrace[]
}

export function emptyExclusionCounts(): Record<RetrievalExclusionReason, number> {
  return {
    retracted: 0,
    sensitivity: 0,
    irrelevant: 0,
    superseded_statement: 0,
    duplicate: 0,
    memory_limit: 0,
    context_budget: 0
  }
}

export function countExclusions(candidates: readonly RetrievalCandidateTrace[]): Record<RetrievalExclusionReason, number> {
  const counts = emptyExclusionCounts()
  for (const candidate of candidates) {
    if (candidate.exclusionReason) counts[candidate.exclusionReason] += 1
  }
  return counts
}

/**
 * Compact projection of a decision for the unified event journal.
 *
 * The journal caps a payload value at 2000 serialized characters, so the full
 * per-candidate trace stays in the returned decision object while only the
 * summary is journaled.
 */
export function retrievalDecisionEventPayload(decision: RetrievalDecision): Record<string, unknown> {
  return {
    algorithm: decision.algorithm,
    algorithmVersion: decision.configVersion,
    evaluatedAt: decision.evaluatedAt,
    considered: decision.considered,
    eligible: decision.eligible,
    selected: decision.selectedIds.length,
    omitted: decision.omitted,
    characterCount: decision.characterCount,
    memoryBudget: decision.memoryBudget,
    contextBudget: decision.contextBudget,
    selectedIds: decision.selectedIds.slice(0, 8),
    exclusionCounts: decision.exclusionCounts,
    correctionChain: decision.correctionChain
  }
}

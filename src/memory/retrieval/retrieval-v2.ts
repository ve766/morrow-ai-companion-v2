import type { AssembledMemoryContext, ContextMemory, Sensitivity } from '../../shared/companion'
import type { MemoryRecord } from '../memory-domain'
import { RETRIEVAL_ALGORITHM_V2, type RetrievalConfig } from './retrieval-config'
import { encodeMemoryContext } from './retrieval-context-format'
import { lexicalScore, lexicalScoreCeiling, normalizeRetrievalText, retrievalTerms, termOverlap } from './retrieval-lexical'
import { classifySupersession } from './retrieval-supersession'
import type { RetrievalRequest, RetrievalResult, RetrievalStrategy } from './retrieval-strategy'
import { countExclusions, type RetrievalCandidateTrace, type RetrievalDecision, type RetrievalExclusionReason, type RetrievalFactors } from './retrieval-trace'

const sensitivityOrder: readonly Sensitivity[] = ['normal', 'personal', 'sensitive']

// The current turn asks about a moment in time rather than a standing fact.
const timeSensitiveQueryPattern = /\b(?:today|tonight|right now|currently|this week|this morning|this afternoon|tomorrow|at the moment|these days)\b|今天|今晚|现在|目前|这次|本周|明天|刚才|眼下|最近/iu
// The memory itself describes a temporary need.
const ephemeralCuePattern = /\b(?:today|tonight|right now|this morning|this afternoon|this week|temporarily|for now|at the moment)\b|今天|今晚|现在|这次|本周|暂时|眼下/iu
// The memory describes a standing preference. Checked first: "I now prefer X"
// is a lasting preference restated, not a temporary need.
const stableCuePattern = /\b(?:always|never|usually|generally|prefer|prefers|every day|all the time|by default)\b|总是|从不|通常|一般|习惯|每次|喜欢|偏好|一向/iu

export type MemoryStability = 'stable' | 'ephemeral' | 'unspecified'

/**
 * Lexical stability heuristic.
 *
 * The production schema has no "kind" column, so long-term preferences and
 * temporary needs can only be told apart from wording. This is an explicit,
 * deterministic rule set, not a semantic model, and the benchmark measures
 * whether it helps. When it is wrong the cost is bounded: it only changes a
 * decay half-life.
 */
export function classifyMemoryStability(text: string): MemoryStability {
  if (stableCuePattern.test(text)) return 'stable'
  if (ephemeralCuePattern.test(text)) return 'ephemeral'
  return 'unspecified'
}

export function isTimeSensitiveQuery(query: string): boolean {
  return timeSensitiveQueryPattern.test(query)
}

function halfLifeDays(record: MemoryRecord, stability: MemoryStability, config: RetrievalConfig): number {
  if (stability === 'ephemeral') return config.decay.ephemeralHalfLifeDays
  return record.sourceCategory === 'user_explicit_input'
    ? config.decay.explicitHalfLifeDays
    : config.decay.inferredHalfLifeDays
}

function decay(ageDays: number, halfLife: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLife)
}

function instantOf(value: string | null | undefined, fallback: string): number {
  const parsed = Date.parse(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function zeroFactors(lexical = 0): RetrievalFactors {
  return { lexical, confidence: 0, provenance: 0, confirmation: 0, recency: 0, timeSensitivity: 0, duplicate: 0, diversity: 0, correction: 0 }
}

interface Prepared {
  record: MemoryRecord
  key: string
  terms: Set<string>
  factors: RetrievalFactors
  baseScore: number
}

function authorityInstant(record: MemoryRecord): number {
  return instantOf(record.lastConfirmedAt, record.updatedAt)
}

/**
 * Total ordering used to break score ties: newer user authority first, then
 * newer update, then id. Without a total order, "deterministic" would be a
 * coincidence of array insertion order.
 */
function beats(candidate: Prepared, score: number, best: Prepared, bestScore: number): boolean {
  if (score !== bestScore) return score > bestScore
  const authority = authorityInstant(candidate.record)
  const bestAuthority = authorityInstant(best.record)
  if (authority !== bestAuthority) return authority > bestAuthority
  if (candidate.record.updatedAt !== best.record.updatedAt) return candidate.record.updatedAt > best.record.updatedAt
  return candidate.record.id < best.record.id
}

/**
 * Multi-signal retrieval (v2).
 *
 * Differences from v1 are deliberate and each one is measured by the offline
 * benchmark:
 *  - the lexical signal is normalized, so it can no longer drown out every
 *    other signal by construction (v1: up to 68 lexical points vs 4 others);
 *  - provenance (how the memory entered the system) and confirmation become
 *    real ranking terms instead of display-only metadata;
 *  - decay depends on stability class, so a standing preference and a
 *    temporary need do not age at the same rate;
 *  - statements that a different, still-active memory already replaced are not
 *    retrieved as current fact (cross-record correction chain);
 *  - near-duplicates are dropped and remaining candidates are diversified.
 *
 * No semantic similarity is invented: with no embedding model available, a
 * memory must still share at least one lexical term with the query.
 */
export class MultiSignalMemoryRetriever implements RetrievalStrategy {
  readonly algorithm = RETRIEVAL_ALGORITHM_V2

  retrieve(request: RetrievalRequest): RetrievalResult {
    const { query, records, maximumSensitivity, now, config } = request
    const queryTerms = retrievalTerms(query)
    const phrase = normalizeRetrievalText(query).trim()
    const ceiling = lexicalScoreCeiling(queryTerms.length)
    const sensitivityLimit = sensitivityOrder.indexOf(maximumSensitivity)
    const timeSensitive = isTimeSensitiveQuery(query)
    const nowInstant = Date.parse(now)

    const candidates: RetrievalCandidateTrace[] = []
    const prepared: Prepared[] = []

    for (const record of records) {
      const factors = zeroFactors()
      const exclude = (reason: RetrievalExclusionReason): void => {
        candidates.push({ memoryId: record.id, included: false, rank: null, exclusionReason: reason, factors, finalScore: 0 })
      }

      if (record.status !== 'active') { exclude('retracted'); continue }
      if (sensitivityOrder.indexOf(record.sensitivity) > sensitivityLimit) { exclude('sensitivity'); continue }

      const lexical = lexicalScore(record.currentText, queryTerms, phrase)
      factors.lexical = lexical
      if (lexical === 0) { exclude('irrelevant'); continue }

      const supersession = classifySupersession(record, request.supersededStatements)
      if (supersession === 'resurrected') {
        factors.correction = 1
        exclude('superseded_statement')
        continue
      }

      const stability = classifyMemoryStability(record.currentText)
      const ageDays = (nowInstant - instantOf(record.lastConfirmedAt, record.updatedAt)) / 86_400_000
      const halfLife = halfLifeDays(record, stability, config)

      factors.confidence = record.confidence / 100
      factors.provenance = config.provenanceScores[record.sourceCategory] ?? 0
      factors.confirmation = record.lastConfirmedAt === null ? 0.5 : 1
      factors.recency = decay(ageDays, halfLife)
      factors.timeSensitivity = timeSensitive ? decay(ageDays, config.decay.timeSensitiveHalfLifeDays) : 0

      const weights = config.weights
      const baseScore =
        weights.lexical * (lexical / ceiling) +
        weights.confidence * factors.confidence +
        weights.provenance * factors.provenance +
        weights.confirmation * factors.confirmation +
        weights.recency * factors.recency +
        weights.timeSensitivity * factors.timeSensitivity

      prepared.push({
        record,
        key: normalizeRetrievalText(record.currentText).replace(/\s+/gu, ' ').trim(),
        terms: new Set(retrievalTerms(record.currentText)),
        factors,
        baseScore
      })
    }

    // Exact-content duplicates cannot both be evidence; keep the stronger one
    // and record the rest with an explicit reason instead of letting them
    // consume the budget. Winners keep their original relative order so the
    // input array still decides nothing but tie-breaks.
    const unique: Prepared[] = []
    const winners = new Map<string, Prepared>()
    for (const item of prepared) {
      const existing = winners.get(item.key)
      if (!existing) {
        winners.set(item.key, item)
        unique.push(item)
        continue
      }
      const challengerWins = item.baseScore > existing.baseScore ||
        (item.baseScore === existing.baseScore && item.record.id < existing.record.id)
      const loser = challengerWins ? existing : item
      if (challengerWins) {
        const position = unique.indexOf(existing)
        if (position >= 0) unique[position] = item
        winners.set(item.key, item)
      }
      candidates.push({
        memoryId: loser.record.id,
        included: false,
        rank: null,
        exclusionReason: 'duplicate',
        factors: { ...loser.factors, duplicate: 1 },
        finalScore: loser.baseScore
      })
    }

    const eligibleCount = prepared.length
    const selected: ContextMemory[] = []
    const selectedTerms: Set<string>[] = []
    let text = encodeMemoryContext(selected)
    const remaining = [...unique]

    // Maximal marginal relevance over a fixed candidate pool. The loop is
    // deterministic: every step re-scores against the same selected set and the
    // tie-break is total.
    while (selected.length < config.maxMemories && remaining.length > 0) {
      let bestIndex = 0
      let bestScore = Number.NEGATIVE_INFINITY
      let bestOverlap = 0

      for (const [index, candidate] of remaining.entries()) {
        let overlapMax = 0
        for (const terms of selectedTerms) {
          const overlap = termOverlap(candidate.terms, terms)
          if (overlap > overlapMax) overlapMax = overlap
        }
        const score = candidate.baseScore - config.weights.diversityPenalty * overlapMax
        if (index === 0 || beats(candidate, score, remaining[bestIndex]!, bestScore)) {
          bestIndex = index
          bestScore = score
          bestOverlap = overlapMax
        }
      }

      const chosen = remaining.splice(bestIndex, 1)[0]!

      // A near-identical statement is not new evidence; drop it rather than
      // spend a second budget slot on the same fact.
      if (bestOverlap >= config.duplicateOverlapThreshold) {
        candidates.push({
          memoryId: chosen.record.id,
          included: false,
          rank: null,
          exclusionReason: 'duplicate',
          factors: { ...chosen.factors, duplicate: bestOverlap, diversity: bestOverlap },
          finalScore: bestScore
        })
        continue
      }

      const nextSelection: ContextMemory[] = [...selected, {
        id: chosen.record.id,
        content: chosen.record.currentText,
        sensitivity: chosen.record.sensitivity,
        updatedAt: chosen.record.updatedAt,
        revision: chosen.record.revision,
        sourceCategory: chosen.record.sourceCategory,
        confidence: chosen.record.confidence,
        score: bestScore
      }]
      const encoded = encodeMemoryContext(nextSelection)

      if (encoded.length > config.maxCharacters) {
        candidates.push({
          memoryId: chosen.record.id,
          included: false,
          rank: null,
          exclusionReason: 'context_budget',
          factors: { ...chosen.factors, diversity: bestOverlap },
          finalScore: bestScore
        })
        continue
      }

      selected.push(nextSelection[nextSelection.length - 1]!)
      text = encoded
      selectedTerms.push(chosen.terms)
      candidates.push({
        memoryId: chosen.record.id,
        included: true,
        rank: selected.length,
        exclusionReason: null,
        factors: { ...chosen.factors, diversity: bestOverlap },
        finalScore: bestScore
      })
    }

    for (const item of remaining) {
      candidates.push({
        memoryId: item.record.id,
        included: false,
        rank: null,
        exclusionReason: 'memory_limit',
        factors: item.factors,
        finalScore: item.baseScore
      })
    }

    const context: AssembledMemoryContext = {
      text,
      selected,
      omitted: eligibleCount - selected.length,
      characterCount: text.length
    }
    const decision: RetrievalDecision = {
      algorithm: RETRIEVAL_ALGORITHM_V2,
      configVersion: config.configVersion,
      evaluatedAt: now,
      maximumSensitivity,
      considered: records.length,
      eligible: eligibleCount,
      selectedIds: selected.map((item) => item.id),
      omitted: context.omitted,
      characterCount: text.length,
      memoryBudget: config.maxMemories,
      contextBudget: config.maxCharacters,
      exclusionCounts: countExclusions(candidates),
      correctionChain: { statements: request.supersededStatements.length, truncated: request.supersededTruncated },
      candidates
    }

    return { context, decision }
  }
}

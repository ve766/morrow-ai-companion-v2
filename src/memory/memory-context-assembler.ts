import type { AssembledMemoryContext, ContextMemory, Sensitivity } from '../shared/companion'
import type { MemoryRecord } from './memory-domain'
import { RETRIEVAL_ALGORITHM_V1, type RetrievalConfig } from './retrieval/retrieval-config'
import { encodeMemoryContext } from './retrieval/retrieval-context-format'
import { lexicalScore, retrievalTerms } from './retrieval/retrieval-lexical'
import type { RetrievalStrategy, RetrievalRequest, RetrievalResult } from './retrieval/retrieval-strategy'
import { countExclusions, type RetrievalCandidateTrace, type RetrievalDecision, type RetrievalFactors } from './retrieval/retrieval-trace'

const order: readonly Sensitivity[] = ['normal', 'personal', 'sensitive']

function recencyBonus(reference: string, now: string): number {
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(reference)) / 86_400_000)
  return 2 * Math.pow(0.5, ageDays / 30)
}

// Ranking combines lexical relevance with provenance quality: confidence
// (1-100) contributes up to 2 points, and a recency bonus of up to 2 points
// decays over 30 days from the last user confirmation (or the last update
// when a record was never confirmed). Ties stay deterministic by id.
//
// This is the audited baseline. Its ordering must not change: it is the control
// arm of every v1/v2 comparison, so the arithmetic below is preserved verbatim.
function rankScore(item: { record: MemoryRecord; score: number }, now: string): number {
  const reference = item.record.lastConfirmedAt ?? item.record.updatedAt
  return item.score + item.record.confidence / 50 + recencyBonus(reference, now)
}

function zeroFactors(lexical = 0): RetrievalFactors {
  return { lexical, confidence: 0, provenance: 0, confirmation: 0, recency: 0, timeSensitivity: 0, semantic: 0, duplicate: 0, diversity: 0, correction: 0 }
}

export class MemoryContextAssembler implements RetrievalStrategy {
  readonly algorithm = RETRIEVAL_ALGORITHM_V1

  assemble(
    query: string,
    records: MemoryRecord[],
    maximumSensitivity: Sensitivity,
    maxMemories = 25,
    maxCharacters = 3000,
    now: string = new Date().toISOString()
  ): AssembledMemoryContext {
    return this.run(query, records, maximumSensitivity, maxMemories, maxCharacters, now, undefined, { statements: 0, truncated: false }).context
  }

  retrieve(request: RetrievalRequest): RetrievalResult {
    return this.run(
      request.query,
      request.records,
      request.maximumSensitivity,
      request.config.maxMemories,
      request.config.maxCharacters,
      request.now,
      request.config,
      { statements: request.supersededStatements.length, truncated: request.supersededTruncated }
    )
  }

  private run(
    query: string,
    records: MemoryRecord[],
    maximumSensitivity: Sensitivity,
    maxMemories: number,
    maxCharacters: number,
    now: string,
    config: RetrievalConfig | undefined,
    correctionChain: { statements: number; truncated: boolean }
  ): RetrievalResult {
    const queryTerms = retrievalTerms(query)
    const phrase = query.normalize('NFKC').trim().toLocaleLowerCase()
    const sensitivityLimit = order.indexOf(maximumSensitivity)

    const excluded: RetrievalCandidateTrace[] = []
    const eligible: Array<{ record: MemoryRecord; score: number }> = []

    for (const record of records) {
      const withinStatus = record.status === 'active'
      const withinSensitivity = order.indexOf(record.sensitivity) <= sensitivityLimit
      const lexical = withinStatus && withinSensitivity ? lexicalScore(record.currentText, queryTerms, phrase) : 0
      const trace: RetrievalCandidateTrace = {
        memoryId: record.id,
        included: false,
        rank: null,
        exclusionReason: null,
        factors: zeroFactors(lexical),
        finalScore: 0
      }
      if (!withinStatus) excluded.push({ ...trace, exclusionReason: 'retracted' })
      else if (!withinSensitivity) excluded.push({ ...trace, exclusionReason: 'sensitivity' })
      else if (lexical === 0) excluded.push({ ...trace, exclusionReason: 'irrelevant' })
      else eligible.push({ record, score: lexical })
    }

    eligible.sort((left, right) =>
      rankScore(right, now) - rankScore(left, now) ||
      right.record.updatedAt.localeCompare(left.record.updatedAt) ||
      left.record.id.localeCompare(right.record.id))

    const selected: ContextMemory[] = []
    const selectedTraces: RetrievalCandidateTrace[] = []
    const unselected: Array<{ record: MemoryRecord; score: number; reason: 'memory_limit' | 'context_budget' }> = []
    let text = encodeMemoryContext(selected)

    // The baseline walks the ranked list and greedily packs what fits; a
    // candidate that does not fit is skipped rather than stopping the scan, so
    // one oversized memory cannot crowd out later ones.
    for (const [index, item] of eligible.entries()) {
      if (index >= maxMemories) {
        unselected.push({ ...item, reason: 'memory_limit' })
        continue
      }
      const candidate: ContextMemory[] = [...selected, {
        id: item.record.id,
        content: item.record.currentText,
        sensitivity: item.record.sensitivity,
        updatedAt: item.record.updatedAt,
        revision: item.record.revision,
        sourceCategory: item.record.sourceCategory,
        confidence: item.record.confidence,
        score: item.score
      }]
      const encoded = encodeMemoryContext(candidate)
      if (encoded.length <= maxCharacters) {
        selected.push(candidate[candidate.length - 1]!)
        text = encoded
        selectedTraces.push({
          memoryId: item.record.id,
          included: true,
          rank: selected.length,
          exclusionReason: null,
          factors: {
            ...zeroFactors(item.score),
            confidence: item.record.confidence / 100,
            confirmation: item.record.lastConfirmedAt === null ? 0 : 1,
            recency: recencyBonus(item.record.lastConfirmedAt ?? item.record.updatedAt, now) / 2
          },
          finalScore: rankScore(item, now)
        })
      } else {
        unselected.push({ ...item, reason: 'context_budget' })
      }
    }

    for (const item of unselected) {
      excluded.push({
        memoryId: item.record.id,
        included: false,
        rank: null,
        exclusionReason: item.reason,
        factors: zeroFactors(item.score),
        finalScore: rankScore(item, now)
      })
    }

    const candidates = [...selectedTraces, ...excluded]
    const decision: RetrievalDecision = {
      algorithm: RETRIEVAL_ALGORITHM_V1,
      configVersion: config?.configVersion ?? 'baseline',
      evaluatedAt: now,
      maximumSensitivity,
      considered: records.length,
      eligible: eligible.length,
      selectedIds: selected.map((item) => item.id),
      omitted: eligible.length - selected.length,
      characterCount: text.length,
      memoryBudget: maxMemories,
      contextBudget: maxCharacters,
      exclusionCounts: countExclusions(candidates),
      correctionChain,
      semantic: { modelId: null, applied: false },
      candidates
    }

    return {
      context: { text, selected, omitted: eligible.length - selected.length, characterCount: text.length },
      decision
    }
  }
}

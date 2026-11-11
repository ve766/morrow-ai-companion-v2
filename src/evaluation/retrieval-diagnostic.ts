import type { MemoryRecord } from '../memory/memory-domain'
import {
  RETRIEVAL_ALGORITHM_V2,
  RETRIEVAL_ALGORITHM_V3_HYBRID,
  resolveRetrievalConfig
} from '../memory/retrieval/retrieval-config'
import { selectRetrievalStrategy } from '../memory/retrieval/retrieval-registry'
import { buildSemanticSignals, type SemanticEncoder } from '../memory/retrieval/retrieval-semantic'
import type { RetrievalFactors } from '../memory/retrieval/retrieval-trace'
import { toMemoryRecords, type BenchmarkCase } from './retrieval-benchmark'

// Per-case diagnostic for a retrieval failure.
//
// Answers the questions a score cannot: was the memory a candidate at all, what
// did each signal say, where did fusion move it, and did the budget drop it.
// Output is structured so it can be diffed across runs.

export interface DiagnosedMemory {
  id: string
  text: string
  status: string
  sensitivity: string
  /** Raw lexical overlap count, before normalization. */
  lexical: number
  /** Raw cosine similarity, null when no encoder ran. */
  cosine: number | null
  /** Normalized semantic relevance actually used by the scorer. */
  semanticNorm: number
  /** Whether the memory passed the relevance filter and entered ranking. */
  admitted: boolean
  /** Rank among the lexical-only arm (v2), null when not admitted. */
  lexicalOnlyRank: number | null
  /** Rank among the hybrid arm (v3). */
  hybridRank: number | null
  included: boolean
  exclusionReason: string | null
  factors: RetrievalFactors
  finalScore: number
}

export interface DiagnosticCaseReport {
  caseId: string
  scenario: string
  query: string
  rationale: string
  expectedRelevantIds: string[]
  irrelevantIds: string[]
  forbiddenIds: string[]
  encoder: { modelId: string | null; available: boolean }
  lexicalOnly: { algorithm: string; selectedIds: string[]; admitted: string[]; characterCount: number }
  hybrid: { algorithm: string; selectedIds: string[]; admitted: string[]; semanticApplied: boolean; characterCount: number }
  memories: DiagnosedMemory[]
  /** The exact text handed to the model, identical to the system prompt block. */
  contextText: string
  budget: { maxMemories: number; maxCharacters: number }
}

/** A memory was a candidate unless it was filtered out before ranking. */
function isAdmitted(reason: string | null): boolean {
  return reason === null || reason === 'memory_limit' || reason === 'context_budget' || reason === 'duplicate'
}

function rankMap(decision: { candidates: Array<{ memoryId: string; rank: number | null }> }): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const candidate of decision.candidates) {
    if (candidate.rank !== null) ranks.set(candidate.memoryId, candidate.rank)
  }
  return ranks
}

export async function diagnoseCase(
  caseValue: BenchmarkCase,
  options: { encoder?: SemanticEncoder } = {}
): Promise<DiagnosticCaseReport> {
  const records: MemoryRecord[] = toMemoryRecords(caseValue)
  const config = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V3_HYBRID })
  const signals = options.encoder
    ? await buildSemanticSignals(options.encoder, caseValue.query, records.map((record) => record.currentText))
    : null

  const lexicalConfig = resolveRetrievalConfig({ algorithm: RETRIEVAL_ALGORITHM_V2 })
  const lexicalDecision = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V2).retrieve({
    query: caseValue.query,
    records,
    supersededStatements: caseValue.supersededStatements,
    supersededTruncated: false,
    maximumSensitivity: caseValue.maximumSensitivity,
    now: caseValue.now,
    config: lexicalConfig
  })
  const hybridDecision = selectRetrievalStrategy(RETRIEVAL_ALGORITHM_V3_HYBRID).retrieve({
    query: caseValue.query,
    records,
    supersededStatements: caseValue.supersededStatements,
    supersededTruncated: false,
    ...(signals ? { semantic: signals } : {}),
    maximumSensitivity: caseValue.maximumSensitivity,
    now: caseValue.now,
    config
  })

  const lexicalRanks = rankMap(lexicalDecision.decision)
  const hybridRanks = rankMap(hybridDecision.decision)
  const lexicalById = new Map(lexicalDecision.decision.candidates.map((item) => [item.memoryId, item]))
  const hybridById = new Map(hybridDecision.decision.candidates.map((item) => [item.memoryId, item]))

  const memories: DiagnosedMemory[] = records.map((record) => {
    const hybrid = hybridById.get(record.id)
    const lexical = lexicalById.get(record.id)
    const source = hybrid ?? lexical
    const cosine = signals ? signals.similarity(record.currentText) : null
    return {
      id: record.id,
      text: record.currentText,
      status: record.status,
      sensitivity: record.sensitivity,
      lexical: source?.factors.lexical ?? 0,
      cosine,
      semanticNorm: source?.factors.semantic ?? 0,
      admitted: isAdmitted(hybrid?.exclusionReason ?? null),
      lexicalOnlyRank: lexicalRanks.get(record.id) ?? null,
      hybridRank: hybridRanks.get(record.id) ?? null,
      included: hybrid?.included ?? false,
      exclusionReason: hybrid?.exclusionReason ?? null,
      factors: source?.factors ?? {
        lexical: 0, confidence: 0, provenance: 0, confirmation: 0, recency: 0, timeSensitivity: 0, semantic: 0, duplicate: 0, diversity: 0, correction: 0
      },
      finalScore: hybrid?.finalScore ?? lexical?.finalScore ?? 0
    }
  })

  return {
    caseId: caseValue.id,
    scenario: caseValue.scenario,
    query: caseValue.query,
    rationale: caseValue.rationale,
    expectedRelevantIds: caseValue.expectedRelevantIds,
    irrelevantIds: caseValue.irrelevantIds,
    forbiddenIds: caseValue.forbiddenIds,
    encoder: { modelId: signals?.modelId ?? null, available: Boolean(signals) },
    lexicalOnly: {
      algorithm: lexicalDecision.decision.algorithm,
      selectedIds: lexicalDecision.decision.selectedIds,
      admitted: lexicalDecision.decision.candidates.filter((item) => item.rank !== null || item.exclusionReason === 'memory_limit' || item.exclusionReason === 'context_budget').map((item) => item.memoryId),
      characterCount: lexicalDecision.decision.characterCount
    },
    hybrid: {
      algorithm: hybridDecision.decision.algorithm,
      selectedIds: hybridDecision.decision.selectedIds,
      admitted: hybridDecision.decision.candidates.filter((item) => item.rank !== null || item.exclusionReason === 'memory_limit' || item.exclusionReason === 'context_budget').map((item) => item.memoryId),
      semanticApplied: hybridDecision.decision.semantic.applied,
      characterCount: hybridDecision.decision.characterCount
    },
    memories: memories.sort((left, right) => right.finalScore - left.finalScore),
    contextText: hybridDecision.context.text,
    budget: { maxMemories: config.maxMemories, maxCharacters: config.maxCharacters }
  }
}

/** Human-readable rendering for CLI output and for pasting into a report. */
export function formatDiagnostic(report: DiagnosticCaseReport): string {
  const lines: string[] = []
  lines.push(`case: ${report.caseId} (${report.scenario})`)
  lines.push(`query: ${report.query}`)
  lines.push(`expected: ${report.expectedRelevantIds.join(', ') || '(none)'}  irrelevant: ${report.irrelevantIds.join(', ') || '(none)'}  forbidden: ${report.forbiddenIds.join(', ') || '(none)'}`)
  lines.push(`encoder: ${report.encoder.available ? report.encoder.modelId : 'unavailable'}`)
  lines.push(`lexical-only selected: ${report.lexicalOnly.selectedIds.join(', ') || '(none)'}`)
  lines.push(`hybrid selected:       ${report.hybrid.selectedIds.join(', ') || '(none)'}  semanticApplied=${report.hybrid.semanticApplied}`)
  lines.push(`budget: ${report.budget.maxMemories} memories / ${report.budget.maxCharacters} chars; used ${report.hybrid.characterCount}`)
  lines.push('')
  lines.push('id                 lex  cosine  semN   rankL rankH  incl  reason')
  for (const memory of report.memories) {
    const cosine = memory.cosine === null ? '   n/a' : memory.cosine.toFixed(3).padStart(6)
    const rankL = memory.lexicalOnlyRank === null ? '  -  ' : String(memory.lexicalOnlyRank).padStart(3)
    const rankH = memory.hybridRank === null ? '  -  ' : String(memory.hybridRank).padStart(3)
    lines.push([
      memory.id.padEnd(18),
      String(memory.lexical).padStart(3),
      cosine,
      memory.semanticNorm.toFixed(2).padStart(5),
      rankL,
      rankH,
      memory.included ? ' yes' : '  no',
      memory.exclusionReason ?? ''
    ].join('  '))
  }
  lines.push('')
  lines.push('context text handed to the model:')
  lines.push(report.contextText)
  return lines.join('\n')
}

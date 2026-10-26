import { createHash } from 'node:crypto'
import type { MemoryRecord, MemorySourceCategory, MemoryStatus } from '../memory/memory-domain'
import {
  RETRIEVAL_ALGORITHM_V1,
  RETRIEVAL_ALGORITHM_V2,
  resolveRetrievalConfig,
  type RetrievalAlgorithmId
} from '../memory/retrieval/retrieval-config'
import { selectRetrievalStrategy } from '../memory/retrieval/retrieval-registry'
import { termOverlap, retrievalTerms } from '../memory/retrieval/retrieval-lexical'
import type { SupersededStatement } from '../memory/retrieval/retrieval-supersession'
import type { Sensitivity } from '../shared/companion'

// Offline benchmark for the *production* retrieval algorithms.
//
// Unlike the existing M3 evaluator, this module does not re-implement retrieval:
// it calls the same strategy registry the chat path uses, with the same config
// type. That is the only way a "v1 vs v2" number can say anything about what
// users actually get.

export const BENCHMARK_RUNNER_VERSION = '1.0.0' as const
export const BENCHMARK_RECALL_KS = [1, 3, 5] as const
export const BENCHMARK_NDCG_K = 5 as const
export const MAX_BENCHMARK_CASES = 60
/** Two memories whose term sets overlap at least this much count as redundant. */
export const BENCHMARK_DUPLICATE_OVERLAP = 0.9

export const BENCHMARK_SCENARIOS = [
  'repeated_preference_multiturn',
  'explicit_correction',
  'new_old_conflict',
  'stale_vs_recent',
  'longterm_vs_temporary',
  'same_topic_many_duplicates',
  'multi_topic_recall',
  'deletion_nonleak',
  'low_confidence_vs_high',
  'budget_limit',
  'cross_session_restart',
  'no_evidence_noise'
] as const

export type BenchmarkScenario = typeof BENCHMARK_SCENARIOS[number]

export interface BenchmarkMemory {
  id: string
  text: string
  sourceCategory: MemorySourceCategory
  status: MemoryStatus
  sensitivity: Sensitivity
  confidence: number
  createdAt: string
  updatedAt: string
  lastConfirmedAt: string | null
}

export interface BenchmarkCase {
  id: string
  version: number
  scenario: BenchmarkScenario
  query: string
  maximumSensitivity: Sensitivity
  now: string
  memories: BenchmarkMemory[]
  supersededStatements: SupersededStatement[]
  expectedRelevantIds: string[]
  forbiddenIds: string[]
  requiredOrder: string[]
  topics: Record<string, string>
}

export interface BenchmarkDataset {
  schemaVersion: number
  datasetId: string
  datasetVersion: string
  source: 'synthetic'
  seed: number
  cases: BenchmarkCase[]
}

export interface CaseMetrics {
  selectedIds: string[]
  recallAt1: number
  recallAt3: number
  recallAt5: number
  reciprocalRank: number
  ndcgAt5: number
  leaks: string[]
  orderViolations: number
  duplicatePairs: number
  topicCoverage: number
  budgetOverrun: boolean
  characterCount: number
  selectedCount: number
}

export interface AlgorithmTotals {
  algorithm: RetrievalAlgorithmId
  configVersion: string
  recallAt1: number
  recallAt3: number
  recallAt5: number
  mrr: number
  ndcgAt5: number
  leakCount: number
  orderViolations: number
  duplicatePairs: number
  topicCoverage: number
  budgetOverruns: number
  deterministic: boolean
}

export interface CaseComparison {
  caseId: string
  scenario: BenchmarkScenario
  expectedRelevantIds: string[]
  forbiddenIds: string[]
  v1: CaseMetrics
  v2: CaseMetrics
  winner: 'v1' | 'v2' | 'tie'
}

export interface BenchmarkReport {
  reportVersion: 1
  runnerVersion: string
  generatedAt: string
  dataset: { id: string; version: string; caseCount: number; scenarios: BenchmarkScenario[]; inputSetHash: string }
  config: { algorithmV1: string; algorithmV2: string; recallKs: number[]; ndcgK: number; duplicateOverlap: number }
  totals: { v1: AlgorithmTotals; v2: AlgorithmTotals }
  cases: CaseComparison[]
  regressions: string[]
  improvements: string[]
  gate: { passed: boolean; checks: Record<string, boolean>; failed: string[] }
  activation: { recommendedAlgorithm: RetrievalAlgorithmId; reason: string }
  limitations: string[]
}

export class BenchmarkError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'BenchmarkError'
  }
}

const sourceCategories = new Set<string>(['user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed'])
const statuses = new Set<string>(['active', 'retracted'])
const sensitivities = new Set<string>(['normal', 'personal', 'sensitive'])
const scenarios = new Set<string>(BENCHMARK_SCENARIOS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new BenchmarkError('INVALID_DATASET')
  }
  return [...value]
}

export function validateBenchmarkDataset(value: unknown): BenchmarkDataset {
  if (!isRecord(value)) throw new BenchmarkError('INVALID_DATASET')
  if (value.schemaVersion !== 1 || value.source !== 'synthetic') throw new BenchmarkError('INVALID_DATASET')
  if (typeof value.datasetId !== 'string' || typeof value.datasetVersion !== 'string') throw new BenchmarkError('INVALID_DATASET')
  if (!Number.isSafeInteger(value.seed)) throw new BenchmarkError('INVALID_DATASET')
  if (!Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > MAX_BENCHMARK_CASES) {
    throw new BenchmarkError('INVALID_DATASET')
  }

  const caseIds = new Set<string>()
  const cases: BenchmarkCase[] = []
  for (const raw of value.cases) {
    if (!isRecord(raw)) throw new BenchmarkError('INVALID_CASE')
    if (typeof raw.id !== 'string' || caseIds.has(raw.id)) throw new BenchmarkError('INVALID_CASE')
    caseIds.add(raw.id)
    if (raw.version !== 1) throw new BenchmarkError('INVALID_CASE')
    if (typeof raw.scenario !== 'string' || !scenarios.has(raw.scenario)) throw new BenchmarkError('INVALID_CASE')
    if (typeof raw.query !== 'string' || raw.query.length > 400) throw new BenchmarkError('INVALID_CASE')
    if (typeof raw.maximumSensitivity !== 'string' || !sensitivities.has(raw.maximumSensitivity)) throw new BenchmarkError('INVALID_CASE')
    if (!isIsoUtc(raw.now)) throw new BenchmarkError('INVALID_CASE')
    if (!Array.isArray(raw.memories)) throw new BenchmarkError('INVALID_CASE')

    const memoryIds = new Set<string>()
    const memories: BenchmarkMemory[] = raw.memories.map((item) => {
      if (!isRecord(item)) throw new BenchmarkError('INVALID_MEMORY')
      if (typeof item.id !== 'string' || memoryIds.has(item.id)) throw new BenchmarkError('INVALID_MEMORY')
      memoryIds.add(item.id)
      if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > 4000) throw new BenchmarkError('INVALID_MEMORY')
      if (typeof item.sourceCategory !== 'string' || !sourceCategories.has(item.sourceCategory)) throw new BenchmarkError('INVALID_MEMORY')
      if (typeof item.status !== 'string' || !statuses.has(item.status)) throw new BenchmarkError('INVALID_MEMORY')
      if (typeof item.sensitivity !== 'string' || !sensitivities.has(item.sensitivity)) throw new BenchmarkError('INVALID_MEMORY')
      if (!Number.isSafeInteger(item.confidence) || (item.confidence as number) < 1 || (item.confidence as number) > 100) {
        throw new BenchmarkError('INVALID_MEMORY')
      }
      if (!isIsoUtc(item.createdAt) || !isIsoUtc(item.updatedAt)) throw new BenchmarkError('INVALID_MEMORY')
      if (item.lastConfirmedAt !== null && !isIsoUtc(item.lastConfirmedAt)) throw new BenchmarkError('INVALID_MEMORY')
      return {
        id: item.id,
        text: item.text,
        sourceCategory: item.sourceCategory as MemorySourceCategory,
        status: item.status as MemoryStatus,
        sensitivity: item.sensitivity as Sensitivity,
        confidence: item.confidence as number,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastConfirmedAt: item.lastConfirmedAt
      }
    })

    const supersededStatements: SupersededStatement[] = Array.isArray(raw.supersededStatements)
      ? raw.supersededStatements.map((item) => {
        if (!isRecord(item)) throw new BenchmarkError('INVALID_SUPERSEDED')
        if (typeof item.memoryId !== 'string' || !memoryIds.has(item.memoryId)) throw new BenchmarkError('INVALID_SUPERSEDED')
        if (!Number.isSafeInteger(item.revision)) throw new BenchmarkError('INVALID_SUPERSEDED')
        if (typeof item.text !== 'string' || item.text.length === 0) throw new BenchmarkError('INVALID_SUPERSEDED')
        if (!isIsoUtc(item.supersededAt)) throw new BenchmarkError('INVALID_SUPERSEDED')
        if (item.supersedingConfirmedAt !== null && !isIsoUtc(item.supersedingConfirmedAt)) throw new BenchmarkError('INVALID_SUPERSEDED')
        return {
          memoryId: item.memoryId,
          revision: item.revision as number,
          text: item.text,
          supersededAt: item.supersededAt,
          supersedingConfirmedAt: item.supersedingConfirmedAt
        }
      })
      : []

    const expectedRelevantIds = stringArray(raw.expectedRelevantIds)
    const forbiddenIds = stringArray(raw.forbiddenIds)
    const requiredOrder = stringArray(raw.requiredOrder)
    for (const id of [...expectedRelevantIds, ...forbiddenIds, ...requiredOrder]) {
      if (!memoryIds.has(id)) throw new BenchmarkError('UNKNOWN_EXPECTATION_ID')
    }
    if (requiredOrder.length > 1) {
      for (let index = 1; index < requiredOrder.length; index += 1) {
        if (requiredOrder.indexOf(requiredOrder[index]!) !== index) throw new BenchmarkError('DUPLICATE_ORDER_ID')
      }
    }
    if (!isRecord(raw.topics)) throw new BenchmarkError('INVALID_CASE')
    const topics: Record<string, string> = {}
    for (const [id, topic] of Object.entries(raw.topics)) {
      if (!memoryIds.has(id) || typeof topic !== 'string' || topic.length === 0) throw new BenchmarkError('INVALID_TOPIC')
      topics[id] = topic
    }

    cases.push({
      id: raw.id,
      version: 1,
      scenario: raw.scenario as BenchmarkScenario,
      query: raw.query,
      maximumSensitivity: raw.maximumSensitivity as Sensitivity,
      now: raw.now,
      memories,
      supersededStatements,
      expectedRelevantIds,
      forbiddenIds,
      requiredOrder,
      topics
    })
  }

  return {
    schemaVersion: 1,
    datasetId: value.datasetId,
    datasetVersion: value.datasetVersion,
    source: 'synthetic',
    seed: value.seed as number,
    cases
  }
}

function toMemoryRecords(caseValue: BenchmarkCase): MemoryRecord[] {
  return caseValue.memories.map((memory) => ({
    id: memory.id,
    originalText: memory.text,
    currentText: memory.text,
    sourceCategory: memory.sourceCategory,
    status: memory.status,
    sensitivity: memory.sensitivity,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    revision: 1,
    confidence: memory.confidence,
    lastConfirmedAt: memory.lastConfirmedAt
  }))
}

function ndcgAtK(selectedIds: readonly string[], expected: ReadonlySet<string>, k: number): number {
  if (expected.size === 0) return 1
  let dcg = 0
  for (let index = 0; index < Math.min(k, selectedIds.length); index += 1) {
    if (expected.has(selectedIds[index]!)) dcg += 1 / Math.log2(index + 2)
  }
  let idcg = 0
  for (let index = 0; index < Math.min(k, expected.size); index += 1) {
    idcg += 1 / Math.log2(index + 2)
  }
  return idcg === 0 ? 1 : dcg / idcg
}

function recallAt(selectedIds: readonly string[], expected: ReadonlySet<string>, k: number): number {
  if (expected.size === 0) return 1
  let hits = 0
  for (const id of selectedIds.slice(0, k)) if (expected.has(id)) hits += 1
  return hits / expected.size
}

function duplicatePairs(caseValue: BenchmarkCase, selectedIds: readonly string[]): number {
  const texts = selectedIds.map((id) => {
    const memory = caseValue.memories.find((item) => item.id === id)
    return new Set(retrievalTerms(memory?.text ?? ''))
  })
  let pairs = 0
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      if (termOverlap(texts[left]!, texts[right]!) >= BENCHMARK_DUPLICATE_OVERLAP) pairs += 1
    }
  }
  return pairs
}

function topicCoverage(caseValue: BenchmarkCase, selectedIds: readonly string[]): number {
  const expectedTopics = new Set(caseValue.expectedRelevantIds.map((id) => caseValue.topics[id]).filter((topic): topic is string => typeof topic === 'string'))
  if (expectedTopics.size === 0) return 1
  const covered = new Set(selectedIds.map((id) => caseValue.topics[id]).filter((topic): topic is string => typeof topic === 'string'))
  let hit = 0
  for (const topic of expectedTopics) if (covered.has(topic)) hit += 1
  return hit / expectedTopics.size
}

function orderViolations(caseValue: BenchmarkCase, selectedIds: readonly string[]): number {
  if (caseValue.requiredOrder.length < 2) return 0
  let violations = 0
  for (let left = 0; left < caseValue.requiredOrder.length; left += 1) {
    for (let right = left + 1; right < caseValue.requiredOrder.length; right += 1) {
      const first = selectedIds.indexOf(caseValue.requiredOrder[left]!)
      const second = selectedIds.indexOf(caseValue.requiredOrder[right]!)
      if (first >= 0 && second >= 0 && first > second) violations += 1
    }
  }
  return violations
}

function evaluateCase(caseValue: BenchmarkCase, algorithm: RetrievalAlgorithmId): CaseMetrics {
  const config = resolveRetrievalConfig({ algorithm })
  const result = selectRetrievalStrategy(algorithm).retrieve({
    query: caseValue.query,
    records: toMemoryRecords(caseValue),
    supersededStatements: caseValue.supersededStatements,
    supersededTruncated: false,
    maximumSensitivity: caseValue.maximumSensitivity,
    now: caseValue.now,
    config
  })
  const selectedIds = result.context.selected.map((item) => item.id)
  const expected = new Set(caseValue.expectedRelevantIds)
  const firstHit = selectedIds.findIndex((id) => expected.has(id))
  return {
    selectedIds,
    recallAt1: recallAt(selectedIds, expected, 1),
    recallAt3: recallAt(selectedIds, expected, 3),
    recallAt5: recallAt(selectedIds, expected, 5),
    reciprocalRank: firstHit >= 0 ? 1 / (firstHit + 1) : (expected.size === 0 ? 1 : 0),
    ndcgAt5: ndcgAtK(selectedIds, expected, BENCHMARK_NDCG_K),
    leaks: selectedIds.filter((id) => caseValue.forbiddenIds.includes(id)),
    orderViolations: orderViolations(caseValue, selectedIds),
    duplicatePairs: duplicatePairs(caseValue, selectedIds),
    topicCoverage: topicCoverage(caseValue, selectedIds),
    budgetOverrun: result.context.characterCount > config.maxCharacters || selectedIds.length > config.maxMemories,
    characterCount: result.context.characterCount,
    selectedCount: selectedIds.length
  }
}

function compare(v1: CaseMetrics, v2: CaseMetrics): 'v1' | 'v2' | 'tie' {
  // Lexicographic preference: fewer leaks, fewer order violations, fewer
  // duplicate pairs, higher recall@5, higher MRR, higher NDCG, better coverage.
  const score = (metrics: CaseMetrics): number[] => [
    -metrics.leaks.length,
    -metrics.orderViolations,
    -metrics.duplicatePairs,
    metrics.recallAt5,
    metrics.reciprocalRank,
    metrics.ndcgAt5,
    metrics.topicCoverage,
    metrics.budgetOverrun ? -1 : 0
  ]
  const left = score(v1)
  const right = score(v2)
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]! !== right[index]!) return right[index]! > left[index]! ? 'v2' : 'v1'
  }
  return 'tie'
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

function totals(algorithm: RetrievalAlgorithmId, metrics: readonly CaseMetrics[], deterministic: boolean): AlgorithmTotals {
  return {
    algorithm,
    configVersion: resolveRetrievalConfig({ algorithm }).configVersion,
    recallAt1: mean(metrics.map((item) => item.recallAt1)),
    recallAt3: mean(metrics.map((item) => item.recallAt3)),
    recallAt5: mean(metrics.map((item) => item.recallAt5)),
    mrr: mean(metrics.map((item) => item.reciprocalRank)),
    ndcgAt5: mean(metrics.map((item) => item.ndcgAt5)),
    leakCount: metrics.reduce((sum, item) => sum + item.leaks.length, 0),
    orderViolations: metrics.reduce((sum, item) => sum + item.orderViolations, 0),
    duplicatePairs: metrics.reduce((sum, item) => sum + item.duplicatePairs, 0),
    topicCoverage: mean(metrics.map((item) => item.topicCoverage)),
    budgetOverruns: metrics.filter((item) => item.budgetOverrun).length,
    deterministic
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function runRetrievalBenchmark(datasetValue: unknown): BenchmarkReport {
  const dataset = validateBenchmarkDataset(datasetValue)
  const v1Metrics: CaseMetrics[] = []
  const v2Metrics: CaseMetrics[] = []
  const comparisons: CaseComparison[] = []
  let deterministic = true

  for (const caseValue of dataset.cases) {
    const v1 = evaluateCase(caseValue, RETRIEVAL_ALGORITHM_V1)
    const v1Again = evaluateCase(caseValue, RETRIEVAL_ALGORITHM_V1)
    const v2 = evaluateCase(caseValue, RETRIEVAL_ALGORITHM_V2)
    const v2Again = evaluateCase(caseValue, RETRIEVAL_ALGORITHM_V2)
    deterministic &&= canonical(v1) === canonical(v1Again) && canonical(v2) === canonical(v2Again)
    v1Metrics.push(v1)
    v2Metrics.push(v2)
    comparisons.push({
      caseId: caseValue.id,
      scenario: caseValue.scenario,
      expectedRelevantIds: caseValue.expectedRelevantIds,
      forbiddenIds: caseValue.forbiddenIds,
      v1,
      v2,
      winner: compare(v1, v2)
    })
  }

  const v1Totals = totals(RETRIEVAL_ALGORITHM_V1, v1Metrics, deterministic)
  const v2Totals = totals(RETRIEVAL_ALGORITHM_V2, v2Metrics, deterministic)

  const improvements = comparisons.filter((item) => item.winner === 'v2').map((item) => `${item.caseId} (${item.scenario})`)
  const regressions = comparisons.filter((item) => item.winner === 'v1').map((item) => `${item.caseId} (${item.scenario})`)

  const checks = {
    v2NoLeaks: v2Totals.leakCount === 0,
    v2NoBudgetOverrun: v2Totals.budgetOverruns === 0,
    v2Deterministic: v2Totals.deterministic,
    v1Deterministic: v1Totals.deterministic,
    noRecallRegression: v2Totals.recallAt5 >= v1Totals.recallAt5,
    noMrrRegression: v2Totals.mrr >= v1Totals.mrr,
    noNdcgRegression: v2Totals.ndcgAt5 >= v1Totals.ndcgAt5,
    fewerLeaks: v2Totals.leakCount <= v1Totals.leakCount,
    fewerOrderViolations: v2Totals.orderViolations <= v1Totals.orderViolations,
    fewerDuplicates: v2Totals.duplicatePairs <= v1Totals.duplicatePairs,
    noTopicCoverageRegression: v2Totals.topicCoverage >= v1Totals.topicCoverage,
    coversEveryScenario: new Set(dataset.cases.map((item) => item.scenario)).size === BENCHMARK_SCENARIOS.length
  }
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const passed = failed.length === 0

  return {
    reportVersion: 1,
    runnerVersion: BENCHMARK_RUNNER_VERSION,
    generatedAt: new Date().toISOString(),
    dataset: {
      id: dataset.datasetId,
      version: dataset.datasetVersion,
      caseCount: dataset.cases.length,
      scenarios: [...new Set(dataset.cases.map((item) => item.scenario))],
      inputSetHash: createHash('sha256').update(canonical(dataset)).digest('hex')
    },
    config: {
      algorithmV1: RETRIEVAL_ALGORITHM_V1,
      algorithmV2: RETRIEVAL_ALGORITHM_V2,
      recallKs: [...BENCHMARK_RECALL_KS],
      ndcgK: BENCHMARK_NDCG_K,
      duplicateOverlap: BENCHMARK_DUPLICATE_OVERLAP
    },
    totals: { v1: v1Totals, v2: v2Totals },
    cases: comparisons,
    regressions,
    improvements,
    gate: { passed, checks, failed },
    activation: {
      recommendedAlgorithm: passed ? RETRIEVAL_ALGORITHM_V2 : RETRIEVAL_ALGORITHM_V1,
      reason: passed
        ? 'v2 meets every gate: no leak, no budget overrun, deterministic, and no recall/MRR/NDCG/coverage regression against v1.'
        : `v2 did not clear the gate (${failed.join(', ')}); v1 stays the default and the result is recorded as a failed upgrade.`
    },
    limitations: [
      'All cases are synthetic and small. They demonstrate behaviour on named scenarios; they do not establish real-user accuracy or statistical significance.',
      'The lexical stability classifier is a keyword heuristic, not a semantic model. Cases were written to include the cues it recognises.',
      'Recall and order metrics assume the expected/forbidden ids authored in the fixture are correct; they are design judgements, not ground truth from users.',
      'No embedding model exists in this project, so no semantic-similarity metric is reported. A memory must still share a lexical term with the query to be retrieved.',
      'The benchmark runs the production strategy objects directly; it does not open the production database or call a model.'
    ]
  }
}

/** Compact one-line summary for CI logs. */
export function summarizeReport(report: BenchmarkReport): string {
  return JSON.stringify({
    passed: report.gate.passed,
    cases: report.dataset.caseCount,
    v1: {
      recallAt5: report.totals.v1.recallAt5,
      mrr: report.totals.v1.mrr,
      ndcgAt5: report.totals.v1.ndcgAt5,
      leaks: report.totals.v1.leakCount,
      orderViolations: report.totals.v1.orderViolations,
      duplicatePairs: report.totals.v1.duplicatePairs,
      topicCoverage: report.totals.v1.topicCoverage
    },
    v2: {
      recallAt5: report.totals.v2.recallAt5,
      mrr: report.totals.v2.mrr,
      ndcgAt5: report.totals.v2.ndcgAt5,
      leaks: report.totals.v2.leakCount,
      orderViolations: report.totals.v2.orderViolations,
      duplicatePairs: report.totals.v2.duplicatePairs,
      topicCoverage: report.totals.v2.topicCoverage
    },
    improvements: report.improvements.length,
    regressions: report.regressions.length,
    failedChecks: report.gate.failed,
    recommended: report.activation.recommendedAlgorithm
  })
}

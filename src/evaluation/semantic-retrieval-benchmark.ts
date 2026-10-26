import { createHash } from 'node:crypto'
import type { MemoryRecord } from '../memory/memory-domain'
import {
  RETRIEVAL_ALGORITHM_V2,
  RETRIEVAL_ALGORITHM_V3_HYBRID,
  resolveRetrievalConfig,
  type RetrievalAlgorithmId,
  type RetrievalConfigOverrides
} from '../memory/retrieval/retrieval-config'
import { selectRetrievalStrategy } from '../memory/retrieval/retrieval-registry'
import { buildSemanticSignals, type SemanticEncoder } from '../memory/retrieval/retrieval-semantic'
import {
  BENCHMARK_NDCG_K,
  canonical,
  compare,
  duplicatePairs,
  mean,
  ndcgAtK,
  orderViolations,
  recallAt,
  toMemoryRecords,
  topicCoverage,
  validateBenchmarkDataset,
  type BenchmarkCase,
  type BenchmarkDataset,
  type CaseMetrics
} from './retrieval-benchmark'

// Multi-arm comparison for the semantic-retrieval decision.
//
// Deliberately separate from retrieval-benchmark.ts: that file is the frozen
// Phase-A v1/v2 regression gate and its report shape must not drift. This one
// answers a different question — "which candidate scheme, if any, earns a place
// in production?" — over the development/validation/holdout splits.

export const SEMANTIC_BENCHMARK_VERSION = '1.0.0' as const

export interface ArmSpec {
  id: string
  label: string
  algorithm: RetrievalAlgorithmId
  /** Whether this arm is allowed to consume semantic signals. */
  usesSemantic: boolean
  config?: RetrievalConfigOverrides
}

export interface ArmTotals {
  armId: string
  label: string
  algorithm: RetrievalAlgorithmId
  semanticApplied: boolean
  recallAt1: number
  recallAt3: number
  recallAt5: number
  mrr: number
  ndcgAt5: number
  leakCount: number
  falseRelevantCount: number
  falseRelevantRate: number
  orderViolations: number
  duplicatePairs: number
  topicCoverage: number
  budgetOverruns: number
  deterministic: boolean
}

export interface ArmCaseResult {
  armId: string
  metrics: CaseMetrics
}

export interface CaseReport {
  caseId: string
  scenario: string
  rationale: string
  query: string
  expectedRelevantIds: string[]
  irrelevantIds: string[]
  forbiddenIds: string[]
  results: ArmCaseResult[]
}

export interface SemanticComparisonReport {
  reportVersion: 1
  runnerVersion: string
  generatedAt: string
  split: string
  dataset: { id: string; version: string; caseCount: number; scenarios: string[]; inputSetHash: string }
  encoder: { modelId: string | null; available: boolean; loadMs: number; meanEmbedMsPerCase: number }
  arms: ArmTotals[]
  cases: CaseReport[]
  byScenario: Array<{ scenario: string; arms: Array<{ armId: string; recallAt1: number; mrr: number }> }>
  gate: { passed: boolean; checks: Record<string, boolean>; failed: string[] }
  limitations: string[]
}

export interface RunOptions {
  /** Encoder used by arms with `usesSemantic`. Absent => those arms run lexical-only. */
  encoder?: SemanticEncoder
  /** Wall-clock cost of building the encoder, reported for transparency. */
  encoderLoadMs?: number
}

function evaluateArm(
  caseValue: BenchmarkCase,
  arm: ArmSpec,
  records: MemoryRecord[],
  semantic: Awaited<ReturnType<typeof buildSemanticSignals>>
): { metrics: CaseMetrics; applied: boolean } {
  const config = resolveRetrievalConfig({ algorithm: arm.algorithm, ...(arm.config ?? {}) })
  const signals = arm.usesSemantic ? semantic ?? undefined : undefined
  const result = selectRetrievalStrategy(arm.algorithm).retrieve({
    query: caseValue.query,
    records,
    supersededStatements: caseValue.supersededStatements,
    supersededTruncated: false,
    ...(signals ? { semantic: signals } : {}),
    maximumSensitivity: caseValue.maximumSensitivity,
    now: caseValue.now,
    config
  })
  const selectedIds = result.context.selected.map((item) => item.id)
  const expected = new Set(caseValue.expectedRelevantIds)
  const firstHit = selectedIds.findIndex((id) => expected.has(id))
  return {
    applied: result.decision.semantic.applied,
    metrics: {
      selectedIds,
      recallAt1: recallAt(selectedIds, expected, 1),
      recallAt3: recallAt(selectedIds, expected, 3),
      recallAt5: recallAt(selectedIds, expected, 5),
      reciprocalRank: firstHit >= 0 ? 1 / (firstHit + 1) : (expected.size === 0 ? 1 : 0),
      ndcgAt5: ndcgAtK(selectedIds, expected, BENCHMARK_NDCG_K),
      leaks: selectedIds.filter((id) => caseValue.forbiddenIds.includes(id)),
      falseRelevant: selectedIds.filter((id) => caseValue.irrelevantIds.includes(id)),
      orderViolations: orderViolations(caseValue, selectedIds),
      duplicatePairs: duplicatePairs(caseValue, selectedIds),
      topicCoverage: topicCoverage(caseValue, selectedIds),
      budgetOverrun: result.context.characterCount > config.maxCharacters || selectedIds.length > config.maxMemories,
      characterCount: result.context.characterCount,
      selectedCount: selectedIds.length
    }
  }
}

function totalsFor(arm: ArmSpec, metrics: readonly CaseMetrics[], applied: boolean, deterministic: boolean): ArmTotals {
  return {
    armId: arm.id,
    label: arm.label,
    algorithm: arm.algorithm,
    semanticApplied: applied,
    recallAt1: mean(metrics.map((item) => item.recallAt1)),
    recallAt3: mean(metrics.map((item) => item.recallAt3)),
    recallAt5: mean(metrics.map((item) => item.recallAt5)),
    mrr: mean(metrics.map((item) => item.reciprocalRank)),
    ndcgAt5: mean(metrics.map((item) => item.ndcgAt5)),
    leakCount: metrics.reduce((sum, item) => sum + item.leaks.length, 0),
    falseRelevantCount: metrics.reduce((sum, item) => sum + item.falseRelevant.length, 0),
    falseRelevantRate: mean(metrics.map((item) => (item.selectedIds.length === 0 ? 0 : item.falseRelevant.length / item.selectedIds.length))),
    orderViolations: metrics.reduce((sum, item) => sum + item.orderViolations, 0),
    duplicatePairs: metrics.reduce((sum, item) => sum + item.duplicatePairs, 0),
    topicCoverage: mean(metrics.map((item) => item.topicCoverage)),
    budgetOverruns: metrics.filter((item) => item.budgetOverrun).length,
    deterministic
  }
}

export const DEFAULT_ARMS: readonly ArmSpec[] = [
  { id: 'v2-lexical', label: 'v2 multi-signal (lexical only)', algorithm: RETRIEVAL_ALGORITHM_V2, usesSemantic: false },
  { id: 'v3-weighted', label: 'v3 hybrid, normalized weighted fusion', algorithm: RETRIEVAL_ALGORITHM_V3_HYBRID, usesSemantic: true, config: { semantic: { fusion: 'weighted' } } },
  { id: 'v3-rrf', label: 'v3 hybrid, reciprocal rank fusion', algorithm: RETRIEVAL_ALGORITHM_V3_HYBRID, usesSemantic: true, config: { semantic: { fusion: 'rrf' } } }
]

export async function runSemanticComparison(
  datasetValue: unknown,
  options: RunOptions = {},
  arms: readonly ArmSpec[] = DEFAULT_ARMS
): Promise<SemanticComparisonReport> {
  const dataset: BenchmarkDataset = validateBenchmarkDataset(datasetValue)
  const cases: CaseReport[] = []
  const metricsByArm = new Map<string, CaseMetrics[]>()
  const appliedByArm = new Map<string, boolean>()
  let deterministic = true
  let embedTotalMs = 0

  for (const arm of arms) {
    metricsByArm.set(arm.id, [])
    appliedByArm.set(arm.id, false)
  }

  for (const caseValue of dataset.cases) {
    const records = toMemoryRecords(caseValue)
    const texts = records.map((record) => record.currentText)

    let semantic: Awaited<ReturnType<typeof buildSemanticSignals>> = null
    if (options.encoder) {
      const startedAt = Date.now()
      semantic = await buildSemanticSignals(options.encoder, caseValue.query, texts)
      embedTotalMs += Date.now() - startedAt
    }

    const results: ArmCaseResult[] = []
    for (const arm of arms) {
      const first = evaluateArm(caseValue, arm, records, semantic)
      const second = evaluateArm(caseValue, arm, records, semantic)
      if (canonical(first.metrics) !== canonical(second.metrics)) deterministic = false
      metricsByArm.get(arm.id)!.push(first.metrics)
      if (first.applied) appliedByArm.set(arm.id, true)
      results.push({ armId: arm.id, metrics: first.metrics })
    }

    cases.push({
      caseId: caseValue.id,
      scenario: caseValue.scenario,
      rationale: caseValue.rationale,
      query: caseValue.query,
      expectedRelevantIds: caseValue.expectedRelevantIds,
      irrelevantIds: caseValue.irrelevantIds,
      forbiddenIds: caseValue.forbiddenIds,
      results
    })
  }

  const totals = arms.map((arm) => totalsFor(arm, metricsByArm.get(arm.id)!, appliedByArm.get(arm.id) ?? false, deterministic))

  const scenarios = [...new Set(dataset.cases.map((item) => item.scenario))]
  const byScenario = scenarios.map((scenario) => {
    const subset = cases.filter((item) => item.scenario === scenario)
    return {
      scenario,
      arms: arms.map((arm) => {
        const values = subset.map((item) => item.results.find((result) => result.armId === arm.id)!.metrics)
        return { armId: arm.id, recallAt1: mean(values.map((item) => item.recallAt1)), mrr: mean(values.map((item) => item.reciprocalRank)) }
      })
    }
  })

  const lexical = totals.find((item) => item.armId === 'v2-lexical')
  const hybridArms = totals.filter((item) => item.semanticApplied)
  const bestHybrid = hybridArms.slice().sort((left, right) => right.mrr - left.mrr)[0]

  // Semantic-dependent scenarios are the only place a hybrid can earn its cost.
  const semanticScenarios = new Set(['paraphrase', 'indirect_expression', 'cross_lingual'])
  const lexicalRecallOnSemantic = mean(
    byScenario.filter((item) => semanticScenarios.has(item.scenario))
      .map((item) => item.arms.find((arm) => arm.armId === 'v2-lexical')?.recallAt1 ?? 0)
  )
  const hybridRecallOnSemantic = bestHybrid
    ? mean(byScenario.filter((item) => semanticScenarios.has(item.scenario))
      .map((item) => item.arms.find((arm) => arm.armId === bestHybrid.armId)?.recallAt1 ?? 0))
    : 0

  const checks: Record<string, boolean> = {
    encoderAvailable: Boolean(options.encoder),
    deterministic,
    hybridNoLeaks: hybridArms.every((item) => item.leakCount === 0),
    hybridNoBudgetOverrun: hybridArms.every((item) => item.budgetOverruns === 0),
    hybridRecallNotWorse: Boolean(lexical && bestHybrid && bestHybrid.recallAt5 >= lexical.recallAt5),
    hybridMrrNotWorse: Boolean(lexical && bestHybrid && bestHybrid.mrr >= lexical.mrr),
    hybridNdcgNotWorse: Boolean(lexical && bestHybrid && bestHybrid.ndcgAt5 >= lexical.ndcgAt5),
    hybridFalseRelevantNotWorse: Boolean(lexical && bestHybrid && bestHybrid.falseRelevantRate <= lexical.falseRelevantRate),
    semanticRecallGain: hybridRecallOnSemantic > lexicalRecallOnSemantic
  }
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)

  return {
    reportVersion: 1,
    runnerVersion: SEMANTIC_BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    split: dataset.datasetId.includes('holdout') ? 'holdout' : dataset.datasetId.includes('validation') ? 'validation' : 'development',
    dataset: {
      id: dataset.datasetId,
      version: dataset.datasetVersion,
      caseCount: dataset.cases.length,
      scenarios,
      inputSetHash: createHash('sha256').update(canonical(dataset)).digest('hex')
    },
    encoder: {
      modelId: options.encoder?.modelId ?? null,
      available: Boolean(options.encoder),
      loadMs: options.encoderLoadMs ?? 0,
      meanEmbedMsPerCase: Number((embedTotalMs / Math.max(1, dataset.cases.length)).toFixed(1))
    },
    arms: totals,
    cases,
    byScenario,
    gate: { passed: failed.length === 0, checks, failed },
    limitations: [
      'All cases are synthetic and few. They show behaviour on named scenarios, not real-user accuracy.',
      'Expected/forbidden/irrelevant labels are design judgements written before any model was run; they are not user annotations.',
      'Cosine similarity is a relevance signal only. It is never treated as evidence confidence.',
      'This runner calls the production strategy objects directly; it does not exercise IPC, the database or a Provider.'
    ]
  }
}

export function summarizeComparison(report: SemanticComparisonReport): string {
  return JSON.stringify({
    split: report.split,
    cases: report.dataset.caseCount,
    encoder: report.encoder,
    arms: report.arms.map((arm) => ({
      arm: arm.armId,
      semanticApplied: arm.semanticApplied,
      recallAt1: arm.recallAt1,
      recallAt5: arm.recallAt5,
      mrr: arm.mrr,
      ndcgAt5: arm.ndcgAt5,
      leaks: arm.leakCount,
      falseRelevantRate: arm.falseRelevantRate,
      orderViolations: arm.orderViolations
    })),
    gate: report.gate
  })
}

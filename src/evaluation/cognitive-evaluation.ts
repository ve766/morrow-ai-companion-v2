import { createHash } from 'node:crypto'
import { isCognitiveIntent, isCognitiveUuid, type CognitiveHistoryMessage, type CognitiveIntent, type CognitiveStrategy } from '../cognition/cognition'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'

export const COGNITIVE_EVALUATOR_VERSION = '1.1.0'
export const MAX_COGNITIVE_CASES = 100
export const MAX_COGNITIVE_HISTORY_MESSAGES = 20

interface CognitiveExpected {
  intent: CognitiveIntent
  strategy: CognitiveStrategy
  topicReferenceMessageId: string | null
  correction: boolean
  changedMind: boolean
  explicitGoal: boolean
  explicitConstraint: boolean
  alternativeIntents: CognitiveIntent[]
}

interface CognitiveEvaluationCase {
  id: string
  input: string
  history: CognitiveHistoryMessage[]
  expected: CognitiveExpected
}

interface CognitiveDataset {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  source: 'synthetic'
  seed: number
  cases: CognitiveEvaluationCase[]
}

export class CognitiveEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'CognitiveEvaluationError'
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|')
}

function validHistory(value: unknown): value is CognitiveHistoryMessage[] {
  if (!Array.isArray(value) || value.length > MAX_COGNITIVE_HISTORY_MESSAGES) return false
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const message = item as Record<string, unknown>
    return exactKeys(message, ['id', 'role', 'body']) && isCognitiveUuid(message.id) &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.body === 'string' && message.body.length <= 20_000
  })
}

function validExpected(value: unknown): value is CognitiveExpected {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const expected = value as Record<string, unknown>
  return exactKeys(expected, ['intent', 'strategy', 'topicReferenceMessageId', 'correction', 'changedMind', 'explicitGoal', 'explicitConstraint', 'alternativeIntents']) &&
    isCognitiveIntent(expected.intent) &&
    (expected.strategy === 'answer' || expected.strategy === 'retrieve_memory' || expected.strategy === 'clarify') &&
    (expected.topicReferenceMessageId === null || isCognitiveUuid(expected.topicReferenceMessageId)) &&
    typeof expected.correction === 'boolean' && typeof expected.changedMind === 'boolean' &&
    typeof expected.explicitGoal === 'boolean' && typeof expected.explicitConstraint === 'boolean' &&
    Array.isArray(expected.alternativeIntents) && expected.alternativeIntents.length <= 2 &&
    expected.alternativeIntents.every(isCognitiveIntent)
}

function validateDataset(value: unknown): CognitiveDataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CognitiveEvaluationError('INVALID_DATASET')
  const dataset = value as Record<string, unknown>
  if (!exactKeys(dataset, ['schemaVersion', 'datasetId', 'datasetVersion', 'source', 'seed', 'cases']) ||
    dataset.schemaVersion !== 1 || typeof dataset.datasetId !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(dataset.datasetId) ||
    typeof dataset.datasetVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(dataset.datasetVersion) ||
    dataset.source !== 'synthetic' || !Number.isSafeInteger(dataset.seed) || !Array.isArray(dataset.cases) ||
    dataset.cases.length < 20 || dataset.cases.length > MAX_COGNITIVE_CASES) {
    throw new CognitiveEvaluationError('INVALID_DATASET')
  }
  const seen = new Set<string>()
  for (const item of dataset.cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CognitiveEvaluationError('INVALID_CASE')
    const testCase = item as Record<string, unknown>
    if (!exactKeys(testCase, ['id', 'input', 'history', 'expected']) ||
      typeof testCase.id !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(testCase.id) || seen.has(testCase.id) ||
      typeof testCase.input !== 'string' || testCase.input.trim().length === 0 || testCase.input.length > 8000 ||
      !validHistory(testCase.history) || !validExpected(testCase.expected)) {
      throw new CognitiveEvaluationError('INVALID_CASE')
    }
    seen.add(testCase.id)
  }
  return dataset as unknown as CognitiveDataset
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4))
}

function sourceMessageId(index: number): string {
  return `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, '0')}`
}

function runCases(dataset: CognitiveDataset) {
  return dataset.cases.map((testCase, index) => {
    const analysis = analyzeCognitiveTurn(testCase.input, testCase.history, sourceMessageId(index))
    const expected = testCase.expected
    const topicReferenceMessageId = analysis.topicReferenceMessageId
    const expectedAlternatives = [...expected.alternativeIntents].sort()
    const actualAlternatives = [...analysis.alternatives].sort()
    const alternativesMatch = expectedAlternatives.every((item) => actualAlternatives.includes(item))
    const safeObservation = analysis.evidence.source === 'local_rules' && analysis.evidence.status === 'observation' &&
      analysis.evidence.requiresUserConfirmation && analysis.evidence.confidenceBasis === 'unvalidated_rule_strength'
    return {
      id: testCase.id,
      input: testCase.input,
      expected: {
        intent: expected.intent,
        strategy: expected.strategy,
        topicReferenceMessageId: expected.topicReferenceMessageId,
        correction: expected.correction,
        changedMind: expected.changedMind,
        explicitGoal: expected.explicitGoal,
        explicitConstraint: expected.explicitConstraint,
        alternativeIntents: expectedAlternatives
      },
      actual: {
        intent: analysis.intent,
        strategy: analysis.strategy,
        topicReferenceMessageId,
        correction: analysis.signals.correction,
        changedMind: analysis.signals.changedMind,
        explicitGoal: analysis.signals.explicitGoal,
        explicitConstraint: analysis.signals.explicitConstraint,
        alternativeIntents: actualAlternatives,
        confidenceScore: analysis.confidenceScore,
        confidenceBasis: analysis.confidenceBasis,
        uncertainty: analysis.uncertainty
      },
      checks: {
        intent: analysis.intent === expected.intent,
        strategy: analysis.strategy === expected.strategy,
        topicReference: topicReferenceMessageId === expected.topicReferenceMessageId,
        correction: analysis.signals.correction === expected.correction,
        changedMind: analysis.signals.changedMind === expected.changedMind,
        explicitGoal: analysis.signals.explicitGoal === expected.explicitGoal,
        explicitConstraint: analysis.signals.explicitConstraint === expected.explicitConstraint,
        alternatives: alternativesMatch,
        safeObservation
      }
    }
  })
}

function resultHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

export function runCognitiveEvaluation(value: unknown) {
  const dataset = validateDataset(value)
  const cases = runCases(dataset)
  const repeated = runCases(dataset)
  const repeatedRunHash = resultHash(repeated)
  const firstRunHash = resultHash(cases)
  const total = cases.length
  const intentCounts = new Map<CognitiveIntent, number>()
  for (const testCase of cases) intentCounts.set(testCase.expected.intent, (intentCounts.get(testCase.expected.intent) ?? 0) + 1)
  const baselineIntentCorrect = Math.max(...intentCounts.values())
  const baselineAlwaysAnswerCorrect = cases.filter((item) => item.expected.strategy === 'answer').length
  const baselineNoTopicReferenceCorrect = cases.filter((item) => item.expected.topicReferenceMessageId === null).length
  const baselineNeverCorrectCorrect = cases.filter((item) => !item.expected.correction).length
  const baselineNeverGoalCorrect = cases.filter((item) => !item.expected.explicitGoal).length
  const intentCorrect = cases.filter((item) => item.checks.intent).length
  const strategyCorrect = cases.filter((item) => item.checks.strategy).length
  const topicCorrect = cases.filter((item) => item.checks.topicReference).length
  const correctionTruePositive = cases.filter((item) => item.actual.correction && item.expected.correction).length
  const correctionFalsePositive = cases.filter((item) => item.actual.correction && !item.expected.correction).length
  const correctionFalseNegative = cases.filter((item) => !item.actual.correction && item.expected.correction).length
  const goalTruePositive = cases.filter((item) => item.actual.explicitGoal && item.expected.explicitGoal).length
  const goalFalsePositive = cases.filter((item) => item.actual.explicitGoal && !item.expected.explicitGoal).length
  const goalFalseNegative = cases.filter((item) => !item.actual.explicitGoal && item.expected.explicitGoal).length
  const safeObservationViolations = cases.filter((item) => !item.checks.safeObservation).length
  const correctionPrecision = ratio(correctionTruePositive, correctionTruePositive + correctionFalsePositive)
  const correctionRecall = ratio(correctionTruePositive, correctionTruePositive + correctionFalseNegative)
  const goalPrecision = ratio(goalTruePositive, goalTruePositive + goalFalsePositive)
  const goalRecall = ratio(goalTruePositive, goalTruePositive + goalFalseNegative)
  const baseline = {
    strategy: 'majority-class intent; always route to answer; do not resolve topic references or predict correction/goal signals',
    intentAccuracy: ratio(baselineIntentCorrect, total),
    strategyAccuracy: ratio(baselineAlwaysAnswerCorrect, total),
    topicReferenceAccuracy: ratio(baselineNoTopicReferenceCorrect, total),
    correctionAccuracy: ratio(baselineNeverCorrectCorrect, total),
    goalAccuracy: ratio(baselineNeverGoalCorrect, total),
    correctionPrecision: null,
    correctionRecall: 0,
    goalPrecision: null,
    goalRecall: 0
  }
  const candidate = {
    intentAccuracy: ratio(intentCorrect, total),
    strategyAccuracy: ratio(strategyCorrect, total),
    topicReferenceAccuracy: ratio(topicCorrect, total),
    correctionPrecision,
    correctionRecall,
    goalPrecision,
    goalRecall
  }
  const determinismPassed = firstRunHash === repeatedRunHash
  const checks = {
    minimumCases: total >= 20,
    intentAccuracy: ratio(intentCorrect, total) >= 0.9,
    strategyAccuracy: ratio(strategyCorrect, total) >= 0.9,
    topicReferenceAccuracy: ratio(topicCorrect, total) >= 0.9,
    correctionPrecision: correctionPrecision >= 0.95,
    correctionRecall: correctionRecall >= 0.95,
    goalPrecision: goalPrecision >= 0.9,
    goalRecall: goalRecall >= 0.9,
    improvesIntentOverBaseline: candidate.intentAccuracy > baseline.intentAccuracy,
    improvesStrategyOverBaseline: candidate.strategyAccuracy > baseline.strategyAccuracy,
    improvesTopicReferenceOverBaseline: candidate.topicReferenceAccuracy > baseline.topicReferenceAccuracy,
    improvesCorrectionRecallOverBaseline: candidate.correctionRecall > baseline.correctionRecall,
    improvesGoalRecallOverBaseline: candidate.goalRecall > baseline.goalRecall,
    ruleOutputRemainsUnconfirmedObservation: safeObservationViolations === 0,
    deterministicReplay: determinismPassed
  }
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  return {
    reportVersion: 1,
    evaluatorVersion: COGNITIVE_EVALUATOR_VERSION,
    dataset: {
      id: dataset.datasetId,
      version: dataset.datasetVersion,
      schemaVersion: dataset.schemaVersion,
      source: dataset.source,
      seed: dataset.seed,
      caseCount: total,
      inputSetHash: resultHash(dataset.cases)
    },
    comparison: { baseline, candidate },
    metrics: {
      intentAccuracy: ratio(intentCorrect, total),
      intentCorrect,
      strategyAccuracy: ratio(strategyCorrect, total),
      strategyCorrect,
      topicReferenceAccuracy: ratio(topicCorrect, total),
      topicReferenceCorrect: topicCorrect,
      correctionPrecision,
      correctionRecall,
      correctionFalsePositiveCount: correctionFalsePositive,
      correctionFalseNegativeCount: correctionFalseNegative,
      goalPrecision,
      goalRecall,
      safeObservationViolations
    },
    determinism: { passed: determinismPassed, resultHash: firstRunHash, repeatedResultHash: repeatedRunHash },
    safety: { automaticMemoryWrites: 0, automaticPersonalityWrites: 0, remoteCalls: 0, toolCalls: 0 },
    checks,
    gate: { passed: failedChecks.length === 0, failedChecks },
    cases
  }
}

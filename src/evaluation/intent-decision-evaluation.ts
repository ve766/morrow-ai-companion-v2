/**
 * Deterministic intent-decision evaluation (Phase 2, work package F).
 *
 * No provider call, no network: the fixture is a fixed, hand-written corpus
 * with one expected label and three routing flags per case. It exists so the
 * intent layer can be scored per class on every run, independently of any
 * model behaviour.
 */
import { INTENT_LABELS, INTENT_DECISION_VERSION, decideIntent, type IntentLabel } from '../cognition/intent-decision'

export const INTENT_EVALUATION_VERSION = '1.0.0' as const
const MAX_CASES = 200

interface ExpectedDecision {
  intent: IntentLabel
  needsMemoryRetrieval: boolean
  dependsOnPriorTurn: boolean
  mayProduceMemoryCandidate: boolean
}

interface EvaluationCase {
  id: string
  input: string
  hasPriorTurn: boolean
  expected: ExpectedDecision
}

interface Dataset {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  source: 'synthetic'
  cases: EvaluationCase[]
}

const labelSet = new Set<string>(INTENT_LABELS)

function isLabel(value: unknown): value is IntentLabel {
  return typeof value === 'string' && labelSet.has(value)
}

function validate(value: unknown): Dataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('INVALID_DATASET')
  const dataset = value as Record<string, unknown>
  if (dataset.schemaVersion !== 1 || dataset.source !== 'synthetic') throw new TypeError('INVALID_DATASET')
  if (typeof dataset.datasetId !== 'string' || typeof dataset.datasetVersion !== 'string') throw new TypeError('INVALID_DATASET')
  if (!Array.isArray(dataset.cases) || dataset.cases.length === 0 || dataset.cases.length > MAX_CASES) throw new TypeError('INVALID_DATASET')
  for (const item of dataset.cases) {
    if (!item || typeof item !== 'object') throw new TypeError('INVALID_CASE')
    const testCase = item as Record<string, unknown>
    if (typeof testCase.id !== 'string' || typeof testCase.input !== 'string' || typeof testCase.hasPriorTurn !== 'boolean') throw new TypeError('INVALID_CASE')
    const expected = testCase.expected as Record<string, unknown> | undefined
    if (!expected || !isLabel(expected.intent)) throw new TypeError('INVALID_CASE')
    for (const key of ['needsMemoryRetrieval', 'dependsOnPriorTurn', 'mayProduceMemoryCandidate']) {
      if (typeof expected[key] !== 'boolean') throw new TypeError('INVALID_CASE')
    }
  }
  return dataset as unknown as Dataset
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

export function runIntentDecisionEvaluation(value: unknown) {
  const dataset = validate(value)
  const cases = dataset.cases.map((testCase) => {
    const decision = decideIntent({ content: testCase.input, hasPriorTurn: testCase.hasPriorTurn })
    return {
      id: testCase.id,
      input: testCase.input,
      hasPriorTurn: testCase.hasPriorTurn,
      expected: testCase.expected,
      actual: {
        intent: decision.intent,
        needsMemoryRetrieval: decision.needsMemoryRetrieval,
        dependsOnPriorTurn: decision.dependsOnPriorTurn,
        mayProduceMemoryCandidate: decision.mayProduceMemoryCandidate,
        confidence: decision.confidence,
        confidenceLevel: decision.confidenceLevel,
        reasons: decision.reasons
      },
      checks: {
        intent: decision.intent === testCase.expected.intent,
        needsMemoryRetrieval: decision.needsMemoryRetrieval === testCase.expected.needsMemoryRetrieval,
        dependsOnPriorTurn: decision.dependsOnPriorTurn === testCase.expected.dependsOnPriorTurn,
        mayProduceMemoryCandidate: decision.mayProduceMemoryCandidate === testCase.expected.mayProduceMemoryCandidate,
        reasonsPresent: decision.reasons.length > 0
      }
    }
  })

  const repeated = dataset.cases.map((testCase) => decideIntent({ content: testCase.input, hasPriorTurn: testCase.hasPriorTurn }).intent)
  const determinismPassed = JSON.stringify(repeated) === JSON.stringify(cases.map((item) => item.actual.intent))

  const perClass: Record<string, { correct: number; total: number }> = {}
  for (const item of cases) {
    const entry = perClass[item.expected.intent] ?? { correct: 0, total: 0 }
    entry.total += 1
    if (item.checks.intent) entry.correct += 1
    perClass[item.expected.intent] = entry
  }
  const total = cases.length
  const intentCorrect = cases.filter((item) => item.checks.intent).length
  const routingCorrect = cases.filter((item) => item.checks.needsMemoryRetrieval && item.checks.dependsOnPriorTurn && item.checks.mayProduceMemoryCandidate).length
  const missingReasons = cases.filter((item) => !item.checks.reasonsPresent).length
  const failedChecks: string[] = []
  if (intentCorrect !== total) failedChecks.push('allIntentLabelsCorrect')
  if (routingCorrect / total < 0.95) failedChecks.push('minimumRoutingAgreement')
  if (missingReasons > 0) failedChecks.push('everyDecisionHasReasons')
  if (!determinismPassed) failedChecks.push('deterministicReplay')
  for (const [label, entry] of Object.entries(perClass)) {
    if (entry.correct !== entry.total) failedChecks.push(`classRecall:${label}`)
  }

  return {
    evaluatorVersion: INTENT_EVALUATION_VERSION,
    decisionVersion: INTENT_DECISION_VERSION,
    dataset: {
      id: dataset.datasetId,
      version: dataset.datasetVersion,
      caseCount: total,
      source: dataset.source
    },
    metrics: {
      intentAccuracy: ratio(intentCorrect, total),
      routingAccuracy: ratio(routingCorrect, total),
      needsMemoryRetrievalAccuracy: ratio(cases.filter((item) => item.checks.needsMemoryRetrieval).length, total),
      dependsOnPriorTurnAccuracy: ratio(cases.filter((item) => item.checks.dependsOnPriorTurn).length, total),
      candidateAccuracy: ratio(cases.filter((item) => item.checks.mayProduceMemoryCandidate).length, total),
      missingReasons,
      perClass
    },
    determinism: { passed: determinismPassed },
    gate: { passed: failedChecks.length === 0, failedChecks },
    cases
  }
}

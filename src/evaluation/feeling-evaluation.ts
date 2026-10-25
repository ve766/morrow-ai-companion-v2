import { createHash } from 'node:crypto'
import { isCognitiveUuid, isCognitiveIntent, type CognitiveHistoryMessage, type CognitiveIntent } from '../cognition/cognition'
import { createDefaultFeelingState, COGNITIVE_ATTENTION_HALF_LIFE_HOURS, FEELING_DIMENSIONS, FEELING_HALF_LIFE_HOURS, applyFeelingEvent, decayFeelingState, type CognitiveFeelingEvent, type FeelingEventType, type FeelingDimension, type FeelingVector } from '../affective-state/feeling'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import { createCognitiveFeelingEvent, feelingPromptGuidance } from '../affective-state/cognitive-feeling-engine'

export const FEELING_EVALUATOR_VERSION = '1.0.1'
export const MAX_FEELING_CASES = 100
const evaluationAt = '2026-10-01T00:00:00.000Z'
const baselineVector: FeelingVector = { valence: 0, activation: 0, tension: 0 }
const expectedSigns: Record<FeelingEventType, FeelingVector> = {
  positive_feedback: { valence: 1, activation: 0, tension: 0 },
  negative_feedback: { valence: -1, activation: 1, tension: 1 },
  system_correction: { valence: -1, activation: 1, tension: 1 },
  exploration_request: { valence: 0, activation: 1, tension: 0 },
  user_context: { valence: 0, activation: 0, tension: 0 },
  preference_change: { valence: 0, activation: 0, tension: 0 }
}
const expectedAttentionSigns: Record<FeelingEventType, -1 | 0 | 1> = {
  positive_feedback: 0,
  negative_feedback: 0,
  system_correction: 0,
  exploration_request: 1,
  user_context: 0,
  preference_change: 0
}

interface FeelingExpected {
  intent: CognitiveIntent
  eventType: FeelingEventType | null
}

interface FeelingCase {
  id: string
  input: string
  history: CognitiveHistoryMessage[]
  expected: FeelingExpected
}

interface FeelingDataset {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  source: 'synthetic'
  seed: number
  cases: FeelingCase[]
}

export class FeelingEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'FeelingEvaluationError'
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|')
}

function validHistory(value: unknown): value is CognitiveHistoryMessage[] {
  if (!Array.isArray(value) || value.length > 20) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const message = item as Record<string, unknown>
    if (!exactKeys(message, ['id', 'role', 'body']) || !isCognitiveUuid(message.id) || seen.has(message.id) ||
      (message.role !== 'user' && message.role !== 'assistant') || typeof message.body !== 'string' || message.body.length > 20_000) return false
    seen.add(message.id)
  }
  return true
}

function validateDataset(value: unknown): FeelingDataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeelingEvaluationError('INVALID_DATASET')
  const dataset = value as Record<string, unknown>
  if (!exactKeys(dataset, ['schemaVersion', 'datasetId', 'datasetVersion', 'source', 'seed', 'cases']) ||
    dataset.schemaVersion !== 1 || typeof dataset.datasetId !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(dataset.datasetId) ||
    typeof dataset.datasetVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(dataset.datasetVersion) || dataset.source !== 'synthetic' ||
    !Number.isSafeInteger(dataset.seed) || !Array.isArray(dataset.cases) || dataset.cases.length < 20 || dataset.cases.length > MAX_FEELING_CASES) {
    throw new FeelingEvaluationError('INVALID_DATASET')
  }
  const seen = new Set<string>()
  for (const item of dataset.cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FeelingEvaluationError('INVALID_CASE')
    const testCase = item as Record<string, unknown>
    if (!exactKeys(testCase, ['id', 'input', 'history', 'expected']) || typeof testCase.id !== 'string' ||
      !/^[a-z0-9-]{1,80}$/u.test(testCase.id) || seen.has(testCase.id) || typeof testCase.input !== 'string' ||
      testCase.input.trim().length === 0 || testCase.input.length > 8000 || !validHistory(testCase.history) ||
      !testCase.expected || typeof testCase.expected !== 'object' || Array.isArray(testCase.expected)) throw new FeelingEvaluationError('INVALID_CASE')
    const expected = testCase.expected as Record<string, unknown>
    if (!exactKeys(expected, ['intent', 'eventType']) || !isCognitiveIntent(expected.intent) ||
      (expected.eventType !== null && !['positive_feedback', 'negative_feedback', 'system_correction', 'exploration_request', 'user_context', 'preference_change'].includes(String(expected.eventType)))) {
      throw new FeelingEvaluationError('INVALID_EXPECTATION')
    }
    seen.add(testCase.id)
  }
  return dataset as unknown as FeelingDataset
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4))
}

function stableId(index: number, prefix: string): string {
  return `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function expectedFor(testCase: FeelingCase): FeelingVector {
  return testCase.expected.eventType ? expectedSigns[testCase.expected.eventType] : baselineVector
}

function sign(value: number): -1 | 0 | 1 {
  return value > 0.0001 ? 1 : value < -0.0001 ? -1 : 0
}

function makeVector(valueFor: (dimension: FeelingDimension) => number): FeelingVector {
  return {
    valence: valueFor('valence'),
    activation: valueFor('activation'),
    tension: valueFor('tension')
  }
}

function behaviorGuidanceMatches(event: CognitiveFeelingEvent | null, guidance: string): boolean {
  if (!event) return guidance.length === 0
  switch (event.type) {
    case 'positive_feedback': return guidance.includes('positive feedback about a prior response')
    case 'negative_feedback':
    case 'system_correction': return guidance.includes('Re-check the disputed point')
    case 'exploration_request': return guidance.includes('Offer one relevant angle')
    case 'user_context': return guidance.includes('not Morrow’s internal state')
    case 'preference_change': return guidance.includes('explicitly changed their mind')
  }
}

function runCases(dataset: FeelingDataset) {
  return dataset.cases.map((testCase, index) => {
    const sourceMessageId = stableId(index, 'dddddddd')
    const turnId = stableId(index, 'ffffffff')
    const analysis = analyzeCognitiveTurn(testCase.input, testCase.history, sourceMessageId)
    const event = createCognitiveFeelingEvent({
      analysis,
      content: testCase.input,
      history: testCase.history,
      conversationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceMessageId,
      idempotencyKey: turnId,
      occurredAt: evaluationAt,
      makeId: () => stableId(index, 'eeeeeeee')
    })
    const initial = createDefaultFeelingState(evaluationAt)
    const state = event ? applyFeelingEvent(initial, event, evaluationAt) : initial
    const expectedDelta = expectedFor(testCase)
    const actualDelta = makeVector((dimension) => state.values[dimension] - initial.values[dimension])
    const directionMatches = FEELING_DIMENSIONS.map((dimension) => sign(actualDelta[dimension]) === expectedDelta[dimension])
    const actualAttentionDelta = state.attention.explorationPriority - initial.attention.explorationPriority
    const expectedAttentionSign = testCase.expected.eventType ? expectedAttentionSigns[testCase.expected.eventType] : 0
    const attentionDirectionMatches = sign(actualAttentionDelta) === expectedAttentionSign
    const guidance = event ? feelingPromptGuidance(analysis, state, event) : ''
    const evidenceTraceable = event === null || event.evidence.refs[0]?.id === sourceMessageId &&
      event.evidence.refs[0]?.role === 'user' && event.evidence.rawTextStored === false &&
      (testCase.history.some((message) => message.role === 'assistant') ? event.relatedAssistantMessageId !== null : event.relatedAssistantMessageId === null)
    const userAffectSeparated = event?.type !== 'user_context' ||
      FEELING_DIMENSIONS.every((dimension) => event.proposedDeltas[dimension] === 0 && state.values[dimension] === 0) &&
      event.proposedAttentionDelta === 0 && state.attention.explorationPriority === 0
    return {
      id: testCase.id,
      expected: { ...testCase.expected, deltaSigns: expectedDelta, attentionSign: expectedAttentionSign },
      actual: {
        intent: analysis.intent,
        eventType: event?.type ?? null,
        confidenceScore: analysis.confidenceScore,
        uncertainty: analysis.uncertainty,
        delta: actualDelta,
        attentionDelta: actualAttentionDelta,
        state: state.values,
        attention: state.attention.explorationPriority
      },
      checks: {
        intent: analysis.intent === testCase.expected.intent,
        eventType: (event?.type ?? null) === testCase.expected.eventType,
        stateDirection: directionMatches.every(Boolean),
        attentionDirection: attentionDirectionMatches,
        stateBounds: FEELING_DIMENSIONS.every((dimension) => dimension === 'valence'
          ? state.values[dimension] >= -1 && state.values[dimension] <= 1
          : state.values[dimension] >= 0 && state.values[dimension] <= 1),
        attentionBounds: state.attention.explorationPriority >= 0 && state.attention.explorationPriority <= 1,
        evidenceTraceable,
        userAffectSeparated,
        behaviorGuidanceApplied: behaviorGuidanceMatches(event, guidance)
      }
    }
  })
}

function parameterSensitivity(feedbackEvent: CognitiveFeelingEvent | null, explorationEvent: CognitiveFeelingEvent | null) {
  const halfLifeScales = [0.5, 1, 2]
  const deltaScales = [0.5, 1, 1.5]
  const affectValues = FEELING_DIMENSIONS.map(() => [] as number[])
  const attentionValues: number[] = []
  if (feedbackEvent) {
    for (const halfLifeScale of halfLifeScales) {
      const halfLives = Object.fromEntries(FEELING_DIMENSIONS.map((dimension) => [dimension, FEELING_HALF_LIFE_HOURS[dimension] * halfLifeScale])) as Record<FeelingDimension, number>
      for (const deltaScale of deltaScales) {
        const atEvent = applyFeelingEvent(createDefaultFeelingState(evaluationAt), feedbackEvent, evaluationAt, { deltaScale })
        const later = decayFeelingState(atEvent, '2026-10-01T06:00:00.000Z', halfLives)
        FEELING_DIMENSIONS.forEach((dimension, index) => affectValues[index]?.push(later.values[dimension]))
      }
    }
  }
  if (explorationEvent) {
    for (const halfLifeScale of halfLifeScales) {
      for (const deltaScale of deltaScales) {
        const atEvent = applyFeelingEvent(createDefaultFeelingState(evaluationAt), explorationEvent, evaluationAt, { deltaScale })
        const later = decayFeelingState(atEvent, '2026-10-01T06:00:00.000Z', FEELING_HALF_LIFE_HOURS,
          COGNITIVE_ATTENTION_HALF_LIFE_HOURS * halfLifeScale)
        attentionValues.push(later.attention.explorationPriority)
      }
    }
  }
  const range = (values: number[]): number[] => values.length === 0
    ? [0, 0]
    : [Number(Math.min(...values).toFixed(4)), Number(Math.max(...values).toFixed(4))]
  return {
    testedCombinations: affectValues[0]!.length + attentionValues.length,
    affectValueRangeAfterSixHours: Object.fromEntries(FEELING_DIMENSIONS.map((dimension, index) => [dimension, range(affectValues[index] ?? [])])) as Record<keyof FeelingVector, number[]>,
    attentionPriorityRangeAfterSixHours: range(attentionValues)
  }
}

function fixtureEvent(dataset: FeelingDataset, eventType: FeelingEventType): CognitiveFeelingEvent | null {
  const index = dataset.cases.findIndex((testCase) => testCase.expected.eventType === eventType)
  if (index < 0) return null
  const testCase = dataset.cases[index]!
  const sourceMessageId = stableId(index, 'dddddddd')
  return createCognitiveFeelingEvent({
    analysis: analyzeCognitiveTurn(testCase.input, testCase.history, sourceMessageId),
    content: testCase.input,
    history: testCase.history,
    conversationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sourceMessageId,
    idempotencyKey: stableId(index, 'ffffffff'),
    occurredAt: evaluationAt,
    makeId: () => stableId(index, 'eeeeeeee')
  })
}



export function runFeelingEvaluation(value: unknown) {
  const dataset = validateDataset(value)
  const cases = runCases(dataset)
  const repeated = runCases(dataset)
  const total = cases.length
  const eventCorrect = cases.filter((item) => item.checks.eventType).length
  const intentCorrect = cases.filter((item) => item.checks.intent).length
  const stateDirectionCorrect = cases.filter((item) => item.checks.stateDirection).length
  const attentionDirectionCorrect = cases.filter((item) => item.checks.attentionDirection).length
  const userAffectTransferCount = cases.filter((item) => !item.checks.userAffectSeparated).length
  const boundViolations = cases.filter((item) => !item.checks.stateBounds).length
  const attentionBoundViolations = cases.filter((item) => !item.checks.attentionBounds).length
  const evidenceTraceabilityFailures = cases.filter((item) => !item.checks.evidenceTraceable).length
  const guidanceFailures = cases.filter((item) => !item.checks.behaviorGuidanceApplied).length
  const expectedEventCount = cases.filter((item) => item.expected.eventType !== null).length
  const predictedEventCount = cases.filter((item) => item.actual.eventType !== null).length
  const eventTruePositiveCount = cases.filter((item) => item.expected.eventType !== null && item.actual.eventType !== null).length
  const eventFalsePositiveCount = cases.filter((item) => item.expected.eventType === null && item.actual.eventType !== null).length
  const eventFalseNegativeCount = cases.filter((item) => item.expected.eventType !== null && item.actual.eventType === null).length
  const eventWrongTypeCount = cases.filter((item) => item.expected.eventType !== null && item.actual.eventType !== null && item.expected.eventType !== item.actual.eventType).length
  const eventPrecision = ratio(eventTruePositiveCount, eventTruePositiveCount + eventFalsePositiveCount)
  const eventRecall = ratio(eventTruePositiveCount, eventTruePositiveCount + eventFalseNegativeCount)
  const baselineNoEventCorrect = total - expectedEventCount
  const baselineStateDirectionCorrect = cases.filter((item) =>
    FEELING_DIMENSIONS.every((dimension) => item.expected.deltaSigns[dimension] === 0)
  ).length
  const baselineAttentionDirectionCorrect = cases.filter((item) => item.expected.attentionSign === 0).length
  const baselineAccuracy = ratio(baselineNoEventCorrect, total)
  const resultHash = hash(cases)
  const repeatedHash = hash(repeated)
  const determinismPassed = resultHash === repeatedHash
  const sensitivity = parameterSensitivity(fixtureEvent(dataset, 'negative_feedback'), fixtureEvent(dataset, 'exploration_request'))
  const checks = {
    minimumCases: total >= 20,
    eventClassificationAccuracy: ratio(eventCorrect, total) >= 0.9,
    eventDetectionPrecision: eventPrecision >= 0.95,
    eventDetectionRecall: eventRecall >= 0.9,
    intentAccuracy: ratio(intentCorrect, total) >= 0.9,
    stateDirectionAccuracy: ratio(stateDirectionCorrect, total) >= 0.95,
    attentionDirectionAccuracy: ratio(attentionDirectionCorrect, total) >= 0.95,
    userEmotionNeverTransferred: userAffectTransferCount === 0,
    valuesStayBounded: boundViolations === 0 && attentionBoundViolations === 0,
    evidenceTraceable: evidenceTraceabilityFailures === 0,
    responsePolicyChanges: guidanceFailures === 0,
    deterministicReplay: determinismPassed
  }
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  return {
    reportVersion: 1,
    evaluatorVersion: FEELING_EVALUATOR_VERSION,
    dataset: { id: dataset.datasetId, version: dataset.datasetVersion, schemaVersion: dataset.schemaVersion, source: dataset.source, seed: dataset.seed, caseCount: total, inputSetHash: hash(dataset.cases) },
    comparison: {
      baseline: {
        strategy: 'no event detection and no state update',
        eventClassificationAccuracy: baselineAccuracy,
        predictedEventCount: 0,
        eventPrecision: null,
        eventPrecisionDefined: false,
        eventRecall: ratio(0, expectedEventCount),
        stateDirectionAccuracy: ratio(baselineStateDirectionCorrect, total),
        attentionDirectionAccuracy: ratio(baselineAttentionDirectionCorrect, total)
      },
      candidate: {
        strategy: 'local rule event detection and bounded state update',
        eventClassificationAccuracy: ratio(eventCorrect, total),
        eventPrecision,
        eventRecall,
        stateDirectionAccuracy: ratio(stateDirectionCorrect, total),
        attentionDirectionAccuracy: ratio(attentionDirectionCorrect, total)
      }
    },
    metrics: {
      expectedEventCount,
      predictedEventCount,
      eventDetectionPrecision: eventPrecision,
      eventDetectionRecall: eventRecall,
      eventFalsePositiveCount,
      eventFalseNegativeCount,
      eventWrongTypeCount,
      intentAccuracy: ratio(intentCorrect, total),
      eventClassificationAccuracy: ratio(eventCorrect, total),
      stateDirectionAccuracy: ratio(stateDirectionCorrect, total),
      attentionDirectionAccuracy: ratio(attentionDirectionCorrect, total),
      attentionBoundViolations,
      userAffectTransferCount,
      boundViolations,
      evidenceTraceabilityFailures,
      behaviorGuidanceFailures: guidanceFailures,
      stateUpdateEvaluations: total * (FEELING_DIMENSIONS.length + 1),
      providerCalls: 0,
      remoteCalls: 0,
      toolCalls: 0
    },
    parameterSensitivity: sensitivity,
    determinism: { passed: determinismPassed, resultHash, repeatedResultHash: repeatedHash },
    checks,
    gate: { passed: failedChecks.length === 0, failedChecks },
    cases
  }
}

export const FEELING_SCHEMA_VERSION = 1 as const
export const FEELING_ENGINE_VERSION = 'evidence-weighted-rules-v1' as const
export const FEELING_STATE_ID = 'morrow-interaction-state' as const

export const FEELING_EVENT_TYPES = [
  'positive_feedback',
  'negative_feedback',
  'system_correction',
  'exploration_request',
  'user_context',
  'preference_change'
] as const

export const FEELING_DIMENSIONS = ['valence', 'activation', 'tension'] as const

export type FeelingEventType = typeof FEELING_EVENT_TYPES[number]
export type FeelingDimension = typeof FEELING_DIMENSIONS[number]
export type FeelingUncertainty = 'low' | 'medium' | 'high'
export type FeelingStateUncertainty = FeelingUncertainty | 'not_scored'

export interface FeelingVector {
  valence: number
  activation: number
  tension: number
}

export interface CognitiveAttentionState {
  explorationPriority: number
  sourceEventId: string | null
  updatedAt: string | null
  evidenceRefs: FeelingEvidenceReference[]
}

export interface FeelingEvidenceReference {
  kind: 'conversation_message'
  id: string
  role: 'user' | 'assistant'
}

export interface FeelingEventInterpretation {
  target: 'system_interaction' | 'user_context' | 'topic_exploration' | 'user_preference'
  meaning:
    | 'explicit_positive_feedback'
    | 'explicit_negative_feedback'
    | 'reported_system_correction'
    | 'requested_exploration'
    | 'user_emotion_context'
    | 'explicit_change_of_mind'
  importanceScore: number
  confidenceScore: number
  confidenceBasis: 'unvalidated_rule_strength'
  uncertainty: FeelingUncertainty
}

export interface CognitiveFeelingEvent {
  schemaVersion: typeof FEELING_SCHEMA_VERSION
  engineVersion: typeof FEELING_ENGINE_VERSION
  id: string
  idempotencyKey: string
  conversationId: string
  sourceMessageId: string
  relatedAssistantMessageId: string | null
  occurredAt: string
  type: FeelingEventType
  source: 'local_rules'
  evidence: {
    storage: 'message_references_only'
    rawTextStored: false
    refs: FeelingEvidenceReference[]
  }
  interpretation: FeelingEventInterpretation
  proposedDeltas: FeelingVector
  proposedAttentionDelta: number
}

export interface FeelingState {
  stateId: typeof FEELING_STATE_ID
  schemaVersion: typeof FEELING_SCHEMA_VERSION
  engineVersion: typeof FEELING_ENGINE_VERSION
  scope: 'short_term_cross_conversation_interaction'
  values: FeelingVector
  attention: CognitiveAttentionState
  revision: number
  evaluatedAt: string
  updatedAt: string | null
  sourceEventId: string | null
  evidenceRefs: FeelingEvidenceReference[]
  confidenceScore: number | null
  uncertainty: FeelingStateUncertainty
  lastEventType: FeelingEventType | null
}

export interface FeelingEventSummary {
  type: FeelingEventType
  occurredAt: string
  processedAt: string
  meaning: FeelingEventInterpretation['meaning']
  importanceScore: number
  confidenceScore: number
  uncertainty: FeelingUncertainty
  proposedDeltas: FeelingVector
  proposedAttentionDelta: number
  stateAfter: FeelingVector
  attentionAfter: number
}

export interface FeelingStateView {
  available: boolean
  state: FeelingState
  eventCount: number
  recentEvents: FeelingEventSummary[]
}

export const FEELING_BASELINE: Readonly<FeelingVector> = Object.freeze({ valence: 0, activation: 0, tension: 0 })
export const COGNITIVE_ATTENTION_BASELINE = 0
export const COGNITIVE_ATTENTION_HALF_LIFE_HOURS = 36

export const FEELING_HALF_LIFE_HOURS: Readonly<Record<FeelingDimension, number>> = Object.freeze({
  valence: 6,
  activation: 0.75,
  tension: 24
})

export const FEELING_EVENT_PROFILES: Readonly<Record<FeelingEventType, Readonly<{
  target: FeelingEventInterpretation['target']
  meaning: FeelingEventInterpretation['meaning']
  importanceScore: number
  proposedDeltas: Readonly<FeelingVector>
  proposedAttentionDelta: number
}>>> = Object.freeze({
  positive_feedback: Object.freeze({
    target: 'system_interaction',
    meaning: 'explicit_positive_feedback',
    importanceScore: 65,
    proposedDeltas: Object.freeze({ valence: 0.16, activation: 0, tension: -0.06 }),
    proposedAttentionDelta: 0
  }),
  negative_feedback: Object.freeze({
    target: 'system_interaction',
    meaning: 'explicit_negative_feedback',
    importanceScore: 75,
    proposedDeltas: Object.freeze({ valence: -0.18, activation: 0.1, tension: 0.18 }),
    proposedAttentionDelta: 0
  }),
  system_correction: Object.freeze({
    target: 'system_interaction',
    meaning: 'reported_system_correction',
    importanceScore: 80,
    proposedDeltas: Object.freeze({ valence: -0.1, activation: 0.08, tension: 0.2 }),
    proposedAttentionDelta: 0
  }),
  exploration_request: Object.freeze({
    target: 'topic_exploration',
    meaning: 'requested_exploration',
    importanceScore: 50,
    proposedDeltas: Object.freeze({ valence: 0, activation: 0.04, tension: 0 }),
    proposedAttentionDelta: 0.14
  }),
  user_context: Object.freeze({
    target: 'user_context',
    meaning: 'user_emotion_context',
    importanceScore: 55,
    proposedDeltas: Object.freeze({ valence: 0, activation: 0, tension: 0 }),
    proposedAttentionDelta: 0
  }),
  preference_change: Object.freeze({
    target: 'user_preference',
    meaning: 'explicit_change_of_mind',
    importanceScore: 55,
    proposedDeltas: Object.freeze({ valence: 0, activation: 0, tension: 0 }),
    proposedAttentionDelta: 0
  })
})



const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const eventTypeSet = new Set<string>(FEELING_EVENT_TYPES)
const dimensionKeys = ['activation', 'tension', 'valence'].join('|')
const eventKeys = [
  'schemaVersion', 'engineVersion', 'id', 'idempotencyKey', 'conversationId', 'sourceMessageId',
  'relatedAssistantMessageId', 'occurredAt', 'type', 'source', 'evidence', 'interpretation', 'proposedDeltas', 'proposedAttentionDelta'
].sort().join('|')
const eventInterpretationKeys = ['target', 'meaning', 'importanceScore', 'confidenceScore', 'confidenceBasis', 'uncertainty'].sort().join('|')
const eventEvidenceKeys = ['storage', 'rawTextStored', 'refs'].sort().join('|')
const stateKeys = [
  'stateId', 'schemaVersion', 'engineVersion', 'scope', 'values', 'attention', 'revision', 'evaluatedAt',
  'updatedAt', 'sourceEventId', 'evidenceRefs', 'confidenceScore', 'uncertainty', 'lastEventType'
].sort().join('|')

function hasExactKeys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join('|') === expected
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40 || !value.endsWith('Z')) return false
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return false
  try {
    return new Date(time).toISOString() === value
  } catch {
    return false
  }
}

function isFeelingVector(value: unknown): value is FeelingVector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const vector = value as Record<string, unknown>
  if (!hasExactKeys(vector, dimensionKeys)) return false
  return Number.isFinite(vector.valence) && Number(vector.valence) >= -1 && Number(vector.valence) <= 1 &&
    Number.isFinite(vector.activation) && Number(vector.activation) >= 0 && Number(vector.activation) <= 1 &&
    Number.isFinite(vector.tension) && Number(vector.tension) >= 0 && Number(vector.tension) <= 1
}

function isFeelingDeltaVector(value: unknown): value is FeelingVector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const vector = value as Record<string, unknown>
  if (!hasExactKeys(vector, dimensionKeys)) return false
  return FEELING_DIMENSIONS.every((dimension) => Number.isFinite(vector[dimension]) && Number(vector[dimension]) >= -1 && Number(vector[dimension]) <= 1)
}

function isFeelingEvidenceReference(value: unknown): value is FeelingEvidenceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  return hasExactKeys(reference, 'id|kind|role') && reference.kind === 'conversation_message' && isUuid(reference.id) &&
    (reference.role === 'user' || reference.role === 'assistant')
}

function isFeelingUncertainty(value: unknown): value is FeelingUncertainty {
  return value === 'low' || value === 'medium' || value === 'high'
}

export function isCognitiveFeelingEvent(value: unknown): value is CognitiveFeelingEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  if (!hasExactKeys(event, eventKeys) || event.schemaVersion !== FEELING_SCHEMA_VERSION || event.engineVersion !== FEELING_ENGINE_VERSION ||
    !isUuid(event.id) || !isUuid(event.idempotencyKey) || !isUuid(event.conversationId) || !isUuid(event.sourceMessageId) ||
    (event.relatedAssistantMessageId !== null && !isUuid(event.relatedAssistantMessageId)) || !isIsoTimestamp(event.occurredAt) ||
    typeof event.type !== 'string' || !eventTypeSet.has(event.type) || event.source !== 'local_rules' || !isFeelingDeltaVector(event.proposedDeltas) ||
    !Number.isFinite(event.proposedAttentionDelta) || Number(event.proposedAttentionDelta) < -1 || Number(event.proposedAttentionDelta) > 1) return false

  if (!event.evidence || typeof event.evidence !== 'object' || Array.isArray(event.evidence)) return false
  const evidence = event.evidence as Record<string, unknown>
  if (!hasExactKeys(evidence, eventEvidenceKeys) || evidence.storage !== 'message_references_only' || evidence.rawTextStored !== false ||
    !Array.isArray(evidence.refs) || evidence.refs.length < 1 || evidence.refs.length > 2 || !evidence.refs.every(isFeelingEvidenceReference)) return false
  const refs = evidence.refs as FeelingEvidenceReference[]
  if (refs[0]?.id !== event.sourceMessageId || refs[0]?.role !== 'user' || new Set(refs.map((item) => item.id)).size !== refs.length) return false
  const assistantRefs = refs.filter((item) => item.role === 'assistant')
  if (event.relatedAssistantMessageId === null ? assistantRefs.length !== 0 : assistantRefs.length !== 1 || assistantRefs[0]?.id !== event.relatedAssistantMessageId) return false

  if (!event.interpretation || typeof event.interpretation !== 'object' || Array.isArray(event.interpretation)) return false
  const interpretation = event.interpretation as Record<string, unknown>
  if (!hasExactKeys(interpretation, eventInterpretationKeys) ||
    !['system_interaction', 'user_context', 'topic_exploration', 'user_preference'].includes(String(interpretation.target)) ||
    !['explicit_positive_feedback', 'explicit_negative_feedback', 'reported_system_correction', 'requested_exploration', 'user_emotion_context', 'explicit_change_of_mind'].includes(String(interpretation.meaning)) ||
    !Number.isSafeInteger(interpretation.importanceScore) || Number(interpretation.importanceScore) < 0 || Number(interpretation.importanceScore) > 100 ||
    !Number.isSafeInteger(interpretation.confidenceScore) || Number(interpretation.confidenceScore) < 0 || Number(interpretation.confidenceScore) > 100 ||
    interpretation.confidenceBasis !== 'unvalidated_rule_strength' || !isFeelingUncertainty(interpretation.uncertainty)) return false

  const proposedDeltas = event.proposedDeltas as FeelingVector
  const profile = FEELING_EVENT_PROFILES[event.type as FeelingEventType]
  return interpretation.target === profile.target && interpretation.meaning === profile.meaning &&
    interpretation.importanceScore === profile.importanceScore && FEELING_DIMENSIONS.every((dimension) =>
      proposedDeltas[dimension] === profile.proposedDeltas[dimension]
    ) && event.proposedAttentionDelta === profile.proposedAttentionDelta
}

function isCognitiveAttentionState(value: unknown): value is CognitiveAttentionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attention = value as Record<string, unknown>
  if (!hasExactKeys(attention, 'evidenceRefs|explorationPriority|sourceEventId|updatedAt') ||
    !Number.isFinite(attention.explorationPriority) || Number(attention.explorationPriority) < COGNITIVE_ATTENTION_BASELINE || Number(attention.explorationPriority) > 1 ||
    (attention.sourceEventId !== null && !isUuid(attention.sourceEventId)) ||
    (attention.updatedAt !== null && !isIsoTimestamp(attention.updatedAt)) ||
    !Array.isArray(attention.evidenceRefs) || attention.evidenceRefs.length > 2 || !attention.evidenceRefs.every(isFeelingEvidenceReference)) return false
  if (attention.sourceEventId === null) return attention.updatedAt === null && attention.evidenceRefs.length === 0 && attention.explorationPriority === COGNITIVE_ATTENTION_BASELINE
  return attention.updatedAt !== null && attention.evidenceRefs.length > 0
}

export function isFeelingState(value: unknown): value is FeelingState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (!hasExactKeys(state, stateKeys) || state.stateId !== FEELING_STATE_ID || state.schemaVersion !== FEELING_SCHEMA_VERSION ||
    state.engineVersion !== FEELING_ENGINE_VERSION || state.scope !== 'short_term_cross_conversation_interaction' || !isFeelingVector(state.values) || !isCognitiveAttentionState(state.attention) ||
    !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || !isIsoTimestamp(state.evaluatedAt) ||
    (state.updatedAt !== null && !isIsoTimestamp(state.updatedAt)) || (state.sourceEventId !== null && !isUuid(state.sourceEventId)) ||
    !Array.isArray(state.evidenceRefs) || state.evidenceRefs.length > 2 || !state.evidenceRefs.every(isFeelingEvidenceReference) ||
    (state.confidenceScore !== null && (!Number.isSafeInteger(state.confidenceScore) || Number(state.confidenceScore) < 0 || Number(state.confidenceScore) > 100)) ||
    !['low', 'medium', 'high', 'not_scored'].includes(String(state.uncertainty)) ||
    (state.lastEventType !== null && (typeof state.lastEventType !== 'string' || !eventTypeSet.has(state.lastEventType)))) return false
  if (Number(state.revision) === 0 && (state.sourceEventId !== null || state.lastEventType !== null || state.updatedAt !== null)) return false
  if (Number(state.revision) > 0 && (state.sourceEventId === null || state.lastEventType === null || state.updatedAt === null || state.confidenceScore === null || state.uncertainty === 'not_scored')) return false
  return true
}

export function createDefaultFeelingState(at: string): FeelingState {
  if (!isIsoTimestamp(at)) throw new TypeError('Invalid feeling-state timestamp.')
  return {
    stateId: FEELING_STATE_ID,
    schemaVersion: FEELING_SCHEMA_VERSION,
    engineVersion: FEELING_ENGINE_VERSION,
    scope: 'short_term_cross_conversation_interaction',
    values: { ...FEELING_BASELINE },
    attention: { explorationPriority: COGNITIVE_ATTENTION_BASELINE, sourceEventId: null, updatedAt: null, evidenceRefs: [] },
    revision: 0,
    evaluatedAt: at,
    updatedAt: null,
    sourceEventId: null,
    evidenceRefs: [],
    confidenceScore: null,
    uncertainty: 'not_scored',
    lastEventType: null
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000
  return Object.is(rounded, -0) ? 0 : rounded
}

function reliabilityWeight(event: CognitiveFeelingEvent): number {
  if (event.interpretation.confidenceScore < 50) return 0
  const confidence = (event.interpretation.confidenceScore - 50) / 50
  const uncertaintyWeight = event.interpretation.uncertainty === 'low' ? 1 : event.interpretation.uncertainty === 'medium' ? 0.5 : 0.2
  const importanceWeight = event.interpretation.importanceScore / 100
  return clamp(confidence * uncertaintyWeight * importanceWeight, 0, 1)
}

/**
 * Largest change one event may make to a dimension.
 *
 * Exported so a test can assert the bound instead of restating the numbers: an
 * eval that hard-codes 0.2 stops checking anything the day the engine changes.
 */
export const FEELING_PER_EVENT_LIMIT: Readonly<Record<FeelingDimension, number>> = Object.freeze({
  valence: 0.2,
  activation: 0.2,
  tension: 0.22
})
const perEventChangeLimit = FEELING_PER_EVENT_LIMIT

export function decayFeelingState(
  state: FeelingState,
  at: string,
  halfLives: Readonly<Record<FeelingDimension, number>> = FEELING_HALF_LIFE_HOURS,
  attentionHalfLifeHours = COGNITIVE_ATTENTION_HALF_LIFE_HOURS
): FeelingState {
  if (!isFeelingState(state) || !isIsoTimestamp(at) || !Number.isFinite(attentionHalfLifeHours) || attentionHalfLifeHours <= 0 ||
    FEELING_DIMENSIONS.some((dimension) => !Number.isFinite(halfLives[dimension]) || halfLives[dimension] <= 0)) {
    throw new TypeError('Invalid feeling-state decay input.')
  }
  const atMs = Math.max(Date.parse(state.evaluatedAt), Date.parse(at))
  const elapsedHours = Math.max(0, (atMs - Date.parse(state.evaluatedAt)) / 3_600_000)
  const values = {} as FeelingVector
  for (const dimension of FEELING_DIMENSIONS) {
    const factor = Math.pow(2, -elapsedHours / halfLives[dimension])
    values[dimension] = round(clamp(FEELING_BASELINE[dimension] + (state.values[dimension] - FEELING_BASELINE[dimension]) * factor, dimension === 'valence' ? -1 : 0, 1))
  }
  const attentionFactor = Math.pow(2, -elapsedHours / attentionHalfLifeHours)
  const attention: CognitiveAttentionState = {
    ...state.attention,
    explorationPriority: round(clamp(COGNITIVE_ATTENTION_BASELINE + (state.attention.explorationPriority - COGNITIVE_ATTENTION_BASELINE) * attentionFactor, COGNITIVE_ATTENTION_BASELINE, 1))
  }
  const evaluatedAt = new Date(atMs).toISOString()
  return { ...state, values, attention, evaluatedAt }
}

export function applyFeelingEvent(
  state: FeelingState,
  event: CognitiveFeelingEvent,
  processedAt: string,
  options: { deltaScale?: number } = {}
): FeelingState {
  const deltaScale = options.deltaScale ?? 1
  if (!isFeelingState(state) || !isCognitiveFeelingEvent(event) || !isIsoTimestamp(processedAt) ||
    !Number.isFinite(deltaScale) || deltaScale < 0 || deltaScale > 2) throw new TypeError('Invalid feeling-state update input.')
  const decayed = decayFeelingState(state, processedAt)
  const weight = reliabilityWeight(event)
  const values = {} as FeelingVector
  for (const dimension of FEELING_DIMENSIONS) {
    const change = clamp(event.proposedDeltas[dimension] * deltaScale, -perEventChangeLimit[dimension], perEventChangeLimit[dimension]) * weight
    const minimum = dimension === 'valence' ? -1 : 0
    values[dimension] = round(clamp(decayed.values[dimension] + change, minimum, 1))
  }
  const attentionChange = clamp(event.proposedAttentionDelta * deltaScale, -0.16, 0.16) * weight
  const attentionPriority = round(clamp(decayed.attention.explorationPriority + attentionChange, COGNITIVE_ATTENTION_BASELINE, 1))
  const attention = event.proposedAttentionDelta === 0
    ? { ...decayed.attention, explorationPriority: attentionPriority }
    : {
        ...decayed.attention,
        explorationPriority: attentionPriority,
        sourceEventId: event.id,
        updatedAt: decayed.evaluatedAt,
        evidenceRefs: event.evidence.refs.map((reference) => ({ ...reference }))
      }
  const next: FeelingState = {
    ...decayed,
    values,
    attention,
    revision: state.revision + 1,
    evaluatedAt: decayed.evaluatedAt,
    updatedAt: decayed.evaluatedAt,
    sourceEventId: event.id,
    evidenceRefs: event.evidence.refs.map((reference) => ({ ...reference })),
    confidenceScore: event.interpretation.confidenceScore,
    uncertainty: event.interpretation.uncertainty,
    lastEventType: event.type
  }
  if (!isFeelingState(next)) throw new TypeError('Invalid feeling-state result.')
  return next
}

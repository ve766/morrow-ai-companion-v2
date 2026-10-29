/**
 * Cognitive turn context, Phase 2.4.
 *
 * One record per turn answers, after the process is gone:
 *
 *   which memories were read -> under which personality version
 *   -> from which internal state -> through which provider -> with what result
 *   -> and what this turn changed.
 *
 * Two rules shape the shape of this record:
 *
 *   1. It stores identifiers, categories and verdicts — never memory text and
 *      never reply text. A record that can answer the question without holding
 *      the user's personal facts is the whole point.
 *   2. It is a *description* of a completed decision, not an input to one.
 *      Reading a context back can never change retrieval, memory or state.
 */
import type { Sensitivity } from '../shared/companion'
import type { IntentLabel } from './intent-decision'

/**
 * Schema 2 adds the Stage 2 cognitive fields. Records written by schema 1 stay
 * readable — `normalizeTurnContext` upgrades them with explicit empty defaults
 * on read — because a field addition must never make past turns look absent.
 */
export const COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION = 2 as const
export const LEGACY_TURN_CONTEXT_SCHEMA_VERSIONS = [1] as const
export type TurnContextSchemaVersion = typeof COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION | typeof LEGACY_TURN_CONTEXT_SCHEMA_VERSIONS[number]

export type CognitiveTurnStatus = 'succeeded' | 'failed' | 'cancelled'

/** How the analyzer read the turn's ambiguity; never a calibrated probability. */
export interface TurnContextUncertainty {
  level: string
  needsClarification: boolean
}

/** What the turn decided to do, recorded so a later reader can explain it. */
export interface TurnContextResponsePlan {
  strategy: string
  memoryWriteAllowed: boolean
}

/** Speech acts the rules actually fired for this turn. */
export const TURN_CONTEXT_SPEECH_ACTS = [
  'correction',
  'negation',
  'changed_mind',
  'explicit_goal',
  'explicit_constraint',
  'memory_recall_request',
  'memory_save_request',
  'explicit_self_fact',
  'topic_switch'
] as const
export type TurnContextSpeechAct = typeof TURN_CONTEXT_SPEECH_ACTS[number]

/** A memory as it was delivered to the model; content is deliberately absent. */
export interface TurnContextMemory {
  id: string
  status: 'active' | 'unresolved'
  sourceCategory: string
  sensitivity: Sensitivity
  revision: number
  updatedAt: string
  /** Relevance score, rounded: a rank signal, not a fact about the user. */
  score: number
}

/**
 * A conflict as it was disclosed: predicate and ids only. The two competing
 * values are personal facts, so they stay out of the persisted record.
 */
export interface TurnContextConflict {
  predicate: string
  memoryIds: string[]
}

/** Compact snapshot of the internal state at a point in the turn. */
export interface TurnContextState {
  revision: number
  valence: number
  activation: number
  tension: number
  explorationPriority: number
  uncertainty: string
}

export interface CognitiveTurnContext {
  schemaVersion: TurnContextSchemaVersion
  /** The turn id (request id) doubles as the idempotency key. */
  turnId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  recordedAt: string
  status: CognitiveTurnStatus
  intent: {
    label: IntentLabel | 'unavailable'
    confidence: number
    confidenceLevel: string
    strategy: string
    reasons: string[]
  }
  retrieval: {
    policyIntent: string
    /** Cap the intent allowed before any state adjustment. */
    baseMax: number
    /** Cap actually applied, after the bounded state adjustment. */
    effectiveMax: number
    /** Why the cap moved, or null when the intent's cap was used unchanged. */
    adjustment: string | null
    selected: TurnContextMemory[]
    conflicts: TurnContextConflict[]
    omitted: number
    maximumSensitivity: Sensitivity
  }
  personality: {
    version: number
    warmth: number
    directness: number
    humor: number
    disagreementStyle: string
  }
  feeling: {
    before: TurnContextState | null
    after: TurnContextState | null
    /** Event type applied to this turn, if any. */
    eventType: string | null
    /** Whether the state change was actually persisted. */
    applied: boolean
  }
  guard: { verdict: 'allow' | 'rewrite'; reason: string; claims: number } | null
  provider: {
    id: string
    model: string
    outcome: CognitiveTurnStatus
    /** Attempt count reported by the provider adapter, when available. */
    attempts: number | null
    /** Error classification for a failed turn, never the provider's message. */
    errorKind: string | null
  }
  updates: {
    pendingItemIds: string[]
    /** Number of memory candidates this turn produced; never their content. */
    memoryCandidates: number
  }
  /**
   * Stage 2 fields. Optional because schema-1 records never wrote them; a
   * reader must treat `undefined` as "this turn predates the field", not as
   * "the turn had none".
   */
  uncertainty?: TurnContextUncertainty
  speechActs?: TurnContextSpeechAct[]
  responsePlan?: TurnContextResponsePlan
  activeInterestIds?: string[]
  selfModelEntryIds?: string[]
  algorithmVersions?: { analyzer: string; intent: string }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const labelPattern = /^[a-z_]{3,40}$/u
const MAX_SELECTED = 25
const MAX_CONFLICTS = 10
const MAX_REASONS = 8

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isState(value: unknown): value is TurnContextState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return isFiniteNumber(state.revision) &&
    isFiniteNumber(state.valence) && isFiniteNumber(state.activation) &&
    isFiniteNumber(state.tension) && isFiniteNumber(state.explorationPriority) &&
    typeof state.uncertainty === 'string'
}

/**
 * Structural check used on the read path. A record that fails this check is
 * treated as absent rather than partially trusted.
 */
export function isCognitiveTurnContext(value: unknown): value is CognitiveTurnContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 && record.schemaVersion !== COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION) return false
  if (typeof record.turnId !== 'string' || !uuidPattern.test(record.turnId)) return false
  if (typeof record.conversationId !== 'string' || !uuidPattern.test(record.conversationId)) return false
  if (typeof record.userMessageId !== 'string' || !uuidPattern.test(record.userMessageId)) return false
  if (record.assistantMessageId !== null && (typeof record.assistantMessageId !== 'string' || !uuidPattern.test(record.assistantMessageId))) return false
  if (typeof record.recordedAt !== 'string' || !Number.isFinite(Date.parse(record.recordedAt))) return false
  if (!['succeeded', 'failed', 'cancelled'].includes(String(record.status))) return false

  const intent = record.intent as Record<string, unknown> | undefined
  if (!intent || typeof intent !== 'object') return false
  if (typeof intent.label !== 'string') return false
  if (intent.label !== 'unavailable' && !labelPattern.test(intent.label)) return false
  if (!isFiniteNumber(intent.confidence)) return false

  const retrieval = record.retrieval as Record<string, unknown> | undefined
  if (!retrieval || typeof retrieval !== 'object') return false
  if (!isFiniteNumber(retrieval.baseMax) || !isFiniteNumber(retrieval.effectiveMax)) return false
  if (retrieval.baseMax < 0 || retrieval.effectiveMax < 0) return false
  if (!Array.isArray(retrieval.selected) || retrieval.selected.length > MAX_SELECTED) return false
  for (const item of retrieval.selected as unknown[]) {
    if (!item || typeof item !== 'object') return false
    const memory = item as Record<string, unknown>
    if (typeof memory.id !== 'string' || !uuidPattern.test(memory.id)) return false
    if (memory.status !== 'active' && memory.status !== 'unresolved') return false
  }
  if (!Array.isArray(retrieval.conflicts) || retrieval.conflicts.length > MAX_CONFLICTS) return false

  const personality = record.personality as Record<string, unknown> | undefined
  if (!personality || typeof personality !== 'object' || !isFiniteNumber(personality.version)) return false

  const feeling = record.feeling as Record<string, unknown> | undefined
  if (!feeling || typeof feeling !== 'object') return false
  if (feeling.before !== null && !isState(feeling.before)) return false
  if (feeling.after !== null && !isState(feeling.after)) return false
  if (typeof feeling.applied !== 'boolean') return false

  const provider = record.provider as Record<string, unknown> | undefined
  if (!provider || typeof provider !== 'object') return false
  if (!['succeeded', 'failed', 'cancelled'].includes(String(provider.outcome))) return false

  const updates = record.updates as Record<string, unknown> | undefined
  if (!updates || typeof updates !== 'object' || !Array.isArray(updates.pendingItemIds)) return false

  // Stage 2 fields are optional for schema 1 and for schema 2 writers that do
  // not compute them yet; when present they must be well formed.
  if (record.speechActs !== undefined) {
    if (!Array.isArray(record.speechActs) || record.speechActs.length > TURN_CONTEXT_SPEECH_ACTS.length) return false
    if (!(record.speechActs as unknown[]).every((act) => typeof act === 'string' && (TURN_CONTEXT_SPEECH_ACTS as readonly string[]).includes(act))) return false
  }
  if (record.uncertainty !== undefined) {
    const uncertainty = record.uncertainty as Record<string, unknown>
    if (!uncertainty || typeof uncertainty !== 'object') return false
    if (typeof uncertainty.level !== 'string' || uncertainty.level.length > 40) return false
    if (typeof uncertainty.needsClarification !== 'boolean') return false
  }
  if (record.responsePlan !== undefined) {
    const plan = record.responsePlan as Record<string, unknown>
    if (!plan || typeof plan !== 'object') return false
    if (typeof plan.strategy !== 'string' || plan.strategy.length > 40) return false
    if (typeof plan.memoryWriteAllowed !== 'boolean') return false
  }
  for (const key of ['activeInterestIds', 'selfModelEntryIds'] as const) {
    const value = record[key]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.length > 25) return false
    if (!(value as unknown[]).every((id) => typeof id === 'string' && uuidPattern.test(id))) return false
  }
  if (record.algorithmVersions !== undefined) {
    const versions = record.algorithmVersions as Record<string, unknown>
    if (!versions || typeof versions !== 'object') return false
    if (typeof versions.analyzer !== 'string' || typeof versions.intent !== 'string') return false
  }
  return true
}

/**
 * Reads any supported stored shape as the current schema.
 *
 * A schema-1 record cannot be silently re-labelled as schema 2 with invented
 * values: the Stage 2 fields stay absent (`undefined`) so a reader can tell
 * "this turn predates the field" from "the turn genuinely had none".
 */
export function normalizeTurnContext(value: unknown): CognitiveTurnContext | null {
  if (!isCognitiveTurnContext(value)) return null
  const record = value as CognitiveTurnContext
  if (record.schemaVersion === COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION) return record
  return { ...record, schemaVersion: COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION }
}

export interface BuildTurnContextInput {
  turnId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  recordedAt: string
  status: CognitiveTurnStatus
  intent: CognitiveTurnContext['intent']
  retrieval: CognitiveTurnContext['retrieval']
  personality: CognitiveTurnContext['personality']
  feeling: CognitiveTurnContext['feeling']
  guard?: CognitiveTurnContext['guard']
  provider: CognitiveTurnContext['provider']
  updates?: Partial<CognitiveTurnContext['updates']>
  uncertainty?: TurnContextUncertainty | undefined
  speechActs?: readonly TurnContextSpeechAct[] | undefined
  responsePlan?: TurnContextResponsePlan | undefined
  activeInterestIds?: readonly string[] | undefined
  selfModelEntryIds?: readonly string[] | undefined
  algorithmVersions?: { analyzer: string; intent: string } | undefined
}

/** Bounds the record so a single turn can never write an unbounded row. */
export function buildCognitiveTurnContext(input: BuildTurnContextInput): CognitiveTurnContext {
  if (!uuidPattern.test(input.turnId) || !uuidPattern.test(input.conversationId) || !uuidPattern.test(input.userMessageId)) {
    throw new TypeError('Turn context requires conversation, turn and message ids.')
  }
  if (input.assistantMessageId !== null && !uuidPattern.test(input.assistantMessageId)) {
    throw new TypeError('Turn context requires a valid assistant message id.')
  }
  if (!Number.isFinite(Date.parse(input.recordedAt))) throw new TypeError('Turn context requires an ISO timestamp.')
  return {
    schemaVersion: COGNITIVE_TURN_CONTEXT_SCHEMA_VERSION,
    turnId: input.turnId.toLowerCase(),
    conversationId: input.conversationId.toLowerCase(),
    userMessageId: input.userMessageId.toLowerCase(),
    assistantMessageId: input.assistantMessageId === null ? null : input.assistantMessageId.toLowerCase(),
    recordedAt: new Date(input.recordedAt).toISOString(),
    status: input.status,
    intent: { ...input.intent, reasons: input.intent.reasons.slice(0, MAX_REASONS) },
    retrieval: {
      ...input.retrieval,
      selected: input.retrieval.selected.slice(0, MAX_SELECTED),
      conflicts: input.retrieval.conflicts.slice(0, MAX_CONFLICTS)
    },
    personality: { ...input.personality },
    feeling: { ...input.feeling },
    guard: input.guard ?? null,
    provider: { ...input.provider },
    updates: {
      pendingItemIds: [...new Set(input.updates?.pendingItemIds ?? [])].slice(0, 50),
      memoryCandidates: Math.max(0, input.updates?.memoryCandidates ?? 0)
    },
    ...(input.uncertainty ? { uncertainty: { ...input.uncertainty } } : {}),
    ...(input.speechActs ? { speechActs: [...new Set(input.speechActs)].slice(0, TURN_CONTEXT_SPEECH_ACTS.length) } : {}),
    ...(input.responsePlan ? { responsePlan: { ...input.responsePlan } } : {}),
    ...(input.activeInterestIds ? { activeInterestIds: [...new Set(input.activeInterestIds)].filter((id) => uuidPattern.test(id)).slice(0, 25) } : {}),
    ...(input.selfModelEntryIds ? { selfModelEntryIds: [...new Set(input.selfModelEntryIds)].filter((id) => uuidPattern.test(id)).slice(0, 25) } : {}),
    ...(input.algorithmVersions ? { algorithmVersions: { ...input.algorithmVersions } } : {})
  }
}

/** Compact state snapshot for the record; no evidence refs, no message text. */
export function snapshotState(state: {
  revision: number
  values: { valence: number; activation: number; tension: number }
  attention: { explorationPriority: number }
  uncertainty: string
}): TurnContextState {
  // `-0` is the same state as `0`, and it would otherwise reach the stored
  // JSON as a different value than the one the state machine produced.
  const round = (value: number): number => {
    const rounded = Number(value.toFixed(4))
    return Object.is(rounded, -0) ? 0 : rounded
  }
  return {
    revision: state.revision,
    valence: round(state.values.valence),
    activation: round(state.values.activation),
    tension: round(state.values.tension),
    explorationPriority: round(state.attention.explorationPriority),
    uncertainty: state.uncertainty
  }
}

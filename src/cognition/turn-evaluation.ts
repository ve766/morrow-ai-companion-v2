/**
 * Turn evaluation ledger, Phase 2 (work package E).
 *
 * One record links what the system decided to what actually happened:
 *
 *   intent  ->  selected memories  ->  payload hash  ->  provider outcome
 *           ->  answer assessment
 *
 * It is a *record*, not a policy. Nothing in this module can change memory,
 * personality, retrieval or permissions: a single answer score must never
 * rewrite the user's long-term model. The ledger is returned to the caller and
 * optionally written to the event journal, which is append-only.
 */
import type { Sensitivity } from '../shared/companion'
import { isAnswerEvidenceAssessment, type AnswerEvidenceAssessment } from './answer-evidence-evaluation'
import type { IntentDecision, IntentLabel } from './intent-decision'

export const TURN_EVALUATION_SCHEMA_VERSION = 1 as const
export type ProviderTurnOutcome = 'succeeded' | 'failed' | 'cancelled'

export interface TurnEvaluation {
  schemaVersion: typeof TURN_EVALUATION_SCHEMA_VERSION
  conversationId: string
  requestId: string
  userMessageId: string
  intent: IntentDecision
  retrieval: {
    intent: IntentLabel
    selectedMemoryIds: string[]
    conflictMemoryIds: string[]
    omitted: number
    maximumSensitivity: Sensitivity
  }
  payload: { sha256: string; characters: number }
  provider: { providerId: string; model: string; outcome: ProviderTurnOutcome }
  answer: AnswerEvidenceAssessment | null
  /**
   * Whether the pre-delivery fact guard changed the text that was delivered.
   * `claims` is a count, never the claim text.
   */
  guard: { verdict: 'allow' | 'rewrite'; reason: string; claims: number } | null
  /**
   * D-5 use trace: which delivered memories the reply plausibly used — a
   * value-level containment match between the reply and a memory's fact
   * value. An objective label, never proof of understanding.
   */
  memoryUse: { referencedIds: string[]; deliveredCount: number } | null
  /**
   * P0-B evidence gate: the four-way failure classification for personal-fact
   * turns plus the bounded decision heuristic. `answerConfidence` is a
   * strategy input assembled from coverage/source/validity/conflict — a
   * heuristic, never a calibrated probability.
   */
  /** Stage 5: the structured strategy this reply followed (no numbers). */
  expressionPolicy: { adviceMode: string; clarifyMode: string; questionBudget: number; brevity: string; rationale: string } | null
  /** Stage 5: relationship thread ids/kinds used in this turn's context. */
  relationshipThreads: Array<{ id: string; kind: string }> | null
  evidenceGate: {
    classification: 'evidence_delivered' | 'retrieval_miss' | 'model_unused' | 'answer_conflict'
    answerConfidence: number
    manifest: { selectedIds: string[]; conflictIds: string[]; omitted: number }
  } | null
  recordedAt: string
}

export interface TurnEvaluationInput {
  conversationId: string
  requestId: string
  userMessageId: string
  decision: IntentDecision
  selectedMemoryIds: readonly string[]
  conflictMemoryIds: readonly string[]
  omitted: number
  maximumSensitivity: Sensitivity
  payloadSha256: string
  payloadCharacters: number
  providerId: string
  model: string
  providerOutcome: ProviderTurnOutcome
  answer: AnswerEvidenceAssessment | null
  guard?: { verdict: 'allow' | 'rewrite'; reason: string; claims: number } | null
  memoryUse?: { referencedIds: readonly string[]; deliveredCount: number } | null
  expressionPolicy?: { adviceMode: string; clarifyMode: string; questionBudget: number; brevity: string; rationale: string } | null
  relationshipThreads?: ReadonlyArray<{ id: string; kind: string }> | null
  evidenceGate?: {
    classification: 'evidence_delivered' | 'retrieval_miss' | 'model_unused' | 'answer_conflict'
    answerConfidence: number
    manifest: { selectedIds: readonly string[]; conflictIds: readonly string[]; omitted: number }
  } | null
  recordedAt: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u

export function buildTurnEvaluation(input: TurnEvaluationInput): TurnEvaluation {
  if (!uuidPattern.test(input.conversationId) || !uuidPattern.test(input.requestId) || !uuidPattern.test(input.userMessageId)) {
    throw new TypeError('Turn evaluation requires conversation, request and message ids.')
  }
  if (!sha256Pattern.test(input.payloadSha256)) throw new TypeError('Turn evaluation requires a payload digest.')
  const recordedAt = new Date(input.recordedAt)
  if (!Number.isFinite(recordedAt.getTime())) throw new TypeError('Turn evaluation requires an ISO timestamp.')
  return {
    schemaVersion: TURN_EVALUATION_SCHEMA_VERSION,
    conversationId: input.conversationId.toLowerCase(),
    requestId: input.requestId.toLowerCase(),
    userMessageId: input.userMessageId.toLowerCase(),
    intent: input.decision,
    retrieval: {
      intent: input.decision.intent,
      selectedMemoryIds: [...new Set(input.selectedMemoryIds)].slice(0, 25),
      conflictMemoryIds: [...new Set(input.conflictMemoryIds)].slice(0, 25),
      omitted: Math.max(0, input.omitted),
      maximumSensitivity: input.maximumSensitivity
    },
    payload: { sha256: input.payloadSha256, characters: Math.max(0, input.payloadCharacters) },
    provider: { providerId: input.providerId, model: input.model, outcome: input.providerOutcome },
    answer: input.answer,
    guard: input.guard ?? null,
    memoryUse: input.memoryUse
      ? { referencedIds: [...new Set(input.memoryUse.referencedIds)].slice(0, 25), deliveredCount: Math.max(0, input.memoryUse.deliveredCount) }
      : null,
    expressionPolicy: input.expressionPolicy
      ? {
          adviceMode: input.expressionPolicy.adviceMode,
          clarifyMode: input.expressionPolicy.clarifyMode,
          questionBudget: input.expressionPolicy.questionBudget,
          brevity: input.expressionPolicy.brevity,
          rationale: input.expressionPolicy.rationale
        }
      : null,
    relationshipThreads: input.relationshipThreads ? [...input.relationshipThreads].slice(0, 8) : null,
    evidenceGate: input.evidenceGate
      ? {
          classification: input.evidenceGate.classification,
          answerConfidence: Math.max(0, Math.min(100, Math.round(input.evidenceGate.answerConfidence))),
          manifest: {
            selectedIds: [...new Set(input.evidenceGate.manifest.selectedIds)].slice(0, 25),
            conflictIds: [...new Set(input.evidenceGate.manifest.conflictIds)].slice(0, 25),
            omitted: Math.max(0, input.evidenceGate.manifest.omitted)
          }
        }
      : null,
    recordedAt: recordedAt.toISOString()
  }
}

export function isTurnEvaluation(value: unknown): value is TurnEvaluation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== TURN_EVALUATION_SCHEMA_VERSION) return false
  for (const key of ['conversationId', 'requestId', 'userMessageId']) {
    if (typeof record[key] !== 'string' || !uuidPattern.test(record[key] as string)) return false
  }
  if (!record.intent || typeof record.intent !== 'object') return false
  if (!record.retrieval || typeof record.retrieval !== 'object') return false
  if (!record.payload || typeof record.payload !== 'object') return false
  if (!record.provider || typeof record.provider !== 'object') return false
  const payload = record.payload as Record<string, unknown>
  if (typeof payload.sha256 !== 'string' || !sha256Pattern.test(payload.sha256)) return false
  const provider = record.provider as Record<string, unknown>
  if (!['succeeded', 'failed', 'cancelled'].includes(String(provider.outcome))) return false
  if (typeof record.recordedAt !== 'string' || !Number.isFinite(Date.parse(record.recordedAt))) return false
  // Phase-2.1 assessments carry dimensions; Phase-2 records without them stay
  // readable, so the nested validator accepts both shapes.
  if (record.answer !== null && !isAnswerEvidenceAssessment(record.answer)) return false
  if (record.guard !== undefined && record.guard !== null) {
    const guard = record.guard as Record<string, unknown>
    if (guard.verdict !== 'allow' && guard.verdict !== 'rewrite') return false
    if (typeof guard.reason !== 'string' || !/^[a-z_]{3,48}$/u.test(guard.reason)) return false
    if (typeof guard.claims !== 'number' || guard.claims < 0 || guard.claims > 100) return false
  }
  return true
}

/** Journal payload: bounded, no reply text, no memory content. */
export function turnEvaluationEventPayload(evaluation: TurnEvaluation): Record<string, unknown> {
  return {
    intent: evaluation.intent.intent,
    legacyIntent: evaluation.intent.legacyIntent,
    confidence: evaluation.intent.confidence,
    reasons: evaluation.intent.reasons.slice(0, 8),
    selectedMemoryCount: evaluation.retrieval.selectedMemoryIds.length,
    conflictCount: evaluation.retrieval.conflictMemoryIds.length,
    omittedCount: evaluation.retrieval.omitted,
    maximumSensitivity: evaluation.retrieval.maximumSensitivity,
    payloadCharacters: evaluation.payload.characters,
    providerOutcome: evaluation.provider.outcome,
    answerOutcome: evaluation.answer?.outcome ?? 'not_scored',
    answerScored: evaluation.answer?.scored ?? false,
    answerDetail: evaluation.answer?.detail ?? 'not_scored',
    memoryUseReferenced: evaluation.memoryUse?.referencedIds.length ?? null,
    memoryUseDelivered: evaluation.memoryUse?.deliveredCount ?? null,
    evidenceGate: evaluation.evidenceGate?.classification ?? null,
    expressionPolicy: evaluation.expressionPolicy?.rationale ?? null,
    relationshipThreads: evaluation.relationshipThreads ? evaluation.relationshipThreads.length : null,
    answerConfidence: evaluation.evidenceGate?.answerConfidence ?? null
  }
}

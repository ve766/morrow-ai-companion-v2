import { randomUUID } from 'node:crypto'
import type { CognitiveHistoryMessage, CognitiveTurnAnalysis } from '../cognition/cognition'
import { isCognitiveTurnAnalysis, isCognitiveUuid, stripQuotedAndReportedText } from '../cognition/cognition'
import {
  FEELING_ENGINE_VERSION,
  FEELING_EVENT_PROFILES,
  applyFeelingEvent,
  decayFeelingState,
  isCognitiveFeelingEvent,
  type CognitiveFeelingEvent,
  type FeelingEventType,
  type FeelingState
} from './feeling'

const positiveFeedback = /(?:谢谢|感谢|有帮助|有用|做得好|回答不错|很满意|你说得对|很好|thank you|thanks|helpful|great answer|well done|that helps|good answer|i appreciate)/iu
const negativeFeedback = /(?:没帮助|没有帮助|不实用|很差|不满意|做得不好|回答错误|答非所问|不对|理解错|不正确|又错了|别再重复|很失望|not helpful|not useful|poor answer|missed the point|wrong|incorrect|misunderstood|disappointed|stop repeating|that's not what|you failed)/iu
const refusalOnly = /^no\s*,?\s*(?:thanks|thank you)\s*[.!?。！]*$/iu
const chineseRefusalOnly = /^(?:不用|不需要|先不用)(?:了)?[，, ]*(?:谢谢|感谢)[。！!]*$/u
const negatedHelpfulness = /(?:not|isn't|is not|wasn't|was not)\s+helpful/giu
const systemCorrection = /(?:你理解错了|你回答错了|你的回答(?:不对|错误|有误)|你说错了|你刚才说.{0,30}(?:不对|错误)|不是我问的|答非所问|你漏掉了|你把.{0,20}(?:弄错|说错)|\b(?:you misunderstood|your answer(?: was| is)? (?:wrong|incorrect)|(?:this|that|the) answer (?:is|was) (?:wrong|incorrect)|you(?:'re| are| were) wrong|you got (?:it|that) wrong|you said .{0,60}(?:wrong|incorrect)|that's not (?:what i asked|right)|that is not right|not what i asked|you missed the point)\b)/iu
const directFeedbackTarget = /(?:你的回答|这(?:个)?回答|你的回复|你刚才的回答|你说得|你理解|回答本身|\b(?:your answer|the answer|this answer|that answer|your response|this response|that response|your reply|you (?:were|are) (?:right|wrong)|you got (?:it|that) wrong|you misunderstood|you missed the point|that helped|it helped|that was not helpful|that wasn't helpful|(?:this|that) (?:was )?helpful|(?:great|good|poor) answer)\b)/iu
const briefAcknowledgement = /^(?:thanks|thank you|谢谢|感谢)[.!?。！! ]*$/iu
const obviousSarcasm = /(?:\b(?:said no one ever|said nobody ever|yeah right|as if)\b|🙃|😏|🙄)/iu

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) throw new TypeError('Invalid cognitive event timestamp.')
  return new Date(parsed).toISOString()
}

function detectEventType(analysis: CognitiveTurnAnalysis, content: string, history: readonly CognitiveHistoryMessage[]): FeelingEventType | null {
  const current = stripQuotedAndReportedText(content)
  if (!current || obviousSarcasm.test(current)) return null
  if (analysis.signals.changedMind) return 'preference_change'
  if (systemCorrection.test(current)) return 'system_correction'
  if (analysis.signals.correction) return null
  if (analysis.intent === 'venting') return 'user_context'
  if (analysis.intent === 'exploration') return 'exploration_request'
  if (analysis.intent !== 'feedback' || refusalOnly.test(current) || chineseRefusalOnly.test(current)) return null
  const hasAssistantContext = history.some((message) => message.role === 'assistant')
  if (!directFeedbackTarget.test(current) && !(hasAssistantContext && briefAcknowledgement.test(current))) return null
  const isNegative = negativeFeedback.test(current)
  const positiveCandidate = current.replace(negatedHelpfulness, '')
  const isPositive = positiveFeedback.test(positiveCandidate)
  if (isNegative === isPositive) return null
  return isNegative ? 'negative_feedback' : 'positive_feedback'
}

export function createCognitiveFeelingEvent(input: {
  analysis: CognitiveTurnAnalysis
  content: string
  history: readonly CognitiveHistoryMessage[]
  conversationId: string
  sourceMessageId: string
  idempotencyKey: string
  occurredAt: string
  makeId?: () => string
}): CognitiveFeelingEvent | null {
  if (!isCognitiveTurnAnalysis(input.analysis) || typeof input.content !== 'string' || input.content.trim().length === 0 ||
    input.content.length > 8000 || !isCognitiveUuid(input.conversationId) || !isCognitiveUuid(input.sourceMessageId) ||
    !isCognitiveUuid(input.idempotencyKey) || input.analysis.evidence.recordId !== input.sourceMessageId) {
    throw new TypeError('Invalid cognitive feeling event input.')
  }
  const occurredAt = normalizeTimestamp(input.occurredAt)
  const type = detectEventType(input.analysis, input.content, input.history)
  if (!type) return null
  const relatedAssistantMessageId = [...input.history].reverse().find((message) => message.role === 'assistant')?.id ?? null
  if (relatedAssistantMessageId !== null && !isCognitiveUuid(relatedAssistantMessageId)) throw new TypeError('Invalid cognitive feeling event reference.')
  const definition = FEELING_EVENT_PROFILES[type]
  const event: CognitiveFeelingEvent = {
    schemaVersion: 1,
    engineVersion: FEELING_ENGINE_VERSION,
    id: (input.makeId ?? randomUUID)().toLowerCase(),
    idempotencyKey: input.idempotencyKey.toLowerCase(),
    conversationId: input.conversationId.toLowerCase(),
    sourceMessageId: input.sourceMessageId.toLowerCase(),
    relatedAssistantMessageId: relatedAssistantMessageId?.toLowerCase() ?? null,
    occurredAt,
    type,
    source: 'local_rules',
    evidence: {
      storage: 'message_references_only',
      rawTextStored: false,
      refs: [
        { kind: 'conversation_message', id: input.sourceMessageId.toLowerCase(), role: 'user' },
        ...(relatedAssistantMessageId ? [{ kind: 'conversation_message' as const, id: relatedAssistantMessageId.toLowerCase(), role: 'assistant' as const }] : [])
      ]
    },
    interpretation: {
      target: definition.target,
      meaning: definition.meaning,
      importanceScore: definition.importanceScore,
      confidenceScore: input.analysis.confidenceScore,
      confidenceBasis: 'unvalidated_rule_strength',
      uncertainty: input.analysis.uncertainty
    },
    proposedDeltas: { ...definition.proposedDeltas },
    proposedAttentionDelta: definition.proposedAttentionDelta
  }
  if (!isCognitiveFeelingEvent(event)) throw new TypeError('Invalid cognitive feeling event.')
  return event
}

export function feelingPromptGuidance(
  analysis: CognitiveTurnAnalysis,
  state: FeelingState,
  event: CognitiveFeelingEvent | null,
  previousState?: FeelingState | null
): string {
  const values = state.values
  const explorationPriority = state.attention.explorationPriority
  const previousExplorationPriority = previousState?.attention.explorationPriority ?? 0
  const hasPriorSignal = state.sourceEventId !== null && state.lastEventType !== null
  if (!event && !hasPriorSignal && Object.values(values).every((value) => Math.abs(value) < 0.01) && explorationPriority < 0.01) return ''
  const lines = [
    `Bounded local interaction-state signal (not subjective experience or evidence about the user): valence=${values.valence.toFixed(2)}, activation=${values.activation.toFixed(2)}, unresolved-tension=${values.tension.toFixed(2)}. Separate cognitive attention/motivation signal: exploration-priority=${explorationPriority.toFixed(2)}. This rule-based state is uncertain, short-lived, and must never override facts, explicit instructions, safety, permissions, or user-controlled personality. Do not describe it as human emotion or reveal its numbers.`,
    event?.type === 'positive_feedback' ? 'The current message contains explicit positive feedback about a prior response. Treat it as evidence about that interaction only; do not make a lasting personality change.' : '',
    event?.type === 'negative_feedback' || event?.type === 'system_correction' ? 'The current message contains explicit negative feedback or a correction. Re-check the disputed point, acknowledge a concrete error when supported, and do not infer the user’s overall mood or change stored memory/personality.' : '',
    event?.type === 'user_context' ? 'User emotions are not Morrow’s internal state. Follow explicit requests for objective help or no reassurance; do not diagnose or assume advice.' : '',
    event?.type === 'exploration_request' && explorationPriority >= 0.04 ? 'The user explicitly invited exploration. Offer one relevant angle or question, without adding unrelated tangents.' : '',
    event?.type === 'exploration_request' && previousExplorationPriority >= 0.04
      ? 'A recent, separate exploration request is a weak continuity signal. Because the user explicitly asks to explore now, offer at most one optional, closely related angle; stay within the current scope and do not continue unless asked.'
      : '',
    event?.type === 'preference_change' ? 'The user explicitly changed their mind. Treat the newer statement as current for this request; do not interpret it as criticism or negative affect.' : '',
    !event && hasPriorSignal && values.tension >= 0.06 && (state.lastEventType === 'negative_feedback' || state.lastEventType === 'system_correction')
      ? 'A recent explicit interaction correction remains a weak, potentially stale signal. Recheck it only if relevant to the current request; do not generalize it to unrelated topics.'
      : '',
    analysis.intent === 'exploration' && explorationPriority >= 0.04 && event?.type !== 'exploration_request'
      ? 'Use an exploratory framing only when it serves the current request; limit optional expansions.'
      : ''
  ]
  return lines.filter(Boolean).join('\n')
}

export function previewFeelingUpdate(state: FeelingState, event: CognitiveFeelingEvent | null, at: string): FeelingState {
  const current = decayFeelingState(state, at)
  return event ? applyFeelingEvent(current, event, at) : current
}

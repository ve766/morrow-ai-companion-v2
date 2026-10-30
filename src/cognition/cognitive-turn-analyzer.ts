import {
  COGNITIVE_ANALYZER_VERSION,
  COGNITIVE_SCHEMA_VERSION,
  createIntentEvidence,
  isCognitiveUuid,
  stripQuotedAndReportedText,
  type CognitiveHistoryMessage,
  type CognitiveIntent,
  type CognitiveTurnAnalysis,
  type CognitiveTurnSignals,
  type CognitiveUncertainty
} from './cognition'
import { decideIntent, type IntentDecision, type IntentLabel } from './intent-decision'
import { assessIntentConfidence, type IntentAssessment } from './intent-confidence'

export const COGNITIVE_HISTORY_LIMIT_MESSAGES = 12
export const COGNITIVE_HISTORY_LIMIT_CHARACTERS = 6000

const stopWords = new Set(['a', 'an', 'and', 'for', 'from', 'have', 'how', 'is', 'it', 'me', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your', '我', '你', '他', '她', '它', '的', '了', '是', '在', '和', '有', '就', '都', '而', '及', '与', '着', '或', '一个'])

/**
 * Feature patterns that feed the prompt guidance and the self-model loop. They
 * are *not* an intent classifier — intent is decided once, in
 * `intent-decision.ts`. Keeping the two apart is what removed the duplicated
 * keyword tables the earlier slices accumulated.
 */
const featurePatterns = {
  negation: /(?:不是|并非|没有|不再|不要|不能|没|不|\b(?:no|not|never|don't|do not|doesn't|didn't|won't|can't|cannot|wouldn't)\b)/iu,
  explicitConstraint: /(?:必须|一定要|不要|不能|仅限|只要|只在|不超过|预算|截止时间|时间限制|避免|\b(?:must|only|don't|do not|cannot|can't|no more than|budget|deadline|avoid|constraint)\b)/iu,
  explicitMemoryRequest: /(?:你还记得|你记得我.{0,24}(?:吗|么)|我(?:之前|上次)告诉过你|我之前说过|我上次提到过|我们之前聊过|能回忆起|我的(?:偏好|目标|习惯)(?:是什么|是什么来着|吗|呢)|\b(?:do you remember|can you recall|what do i|what did i tell you|what have i told you|recall my|what is my|what's my)\b)/iu,
  explicitMemorySaveRequest: /(?:请(?:你)?记住|记住(?:我|这个|这件事|一下)|以后(?:都)?记得|把这(?:条|件事|个)记下来|保存为记忆|\b(?:please remember|remember that|remember this|save this as a memory|save that as a memory)\b)/iu,
  explicitSelfFact: /(?:我(?:不喜欢|喜欢|偏好|住在|工作在|从事|通常|习惯|的目标|的生日|会)|\bi (?:(?:do not|don't) )?(?:like|prefer|dislike|live|work|usually|tend to|use|avoid)\b)/iu
} as const

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

function wordCount(value: string): number {
  const normalized = normalize(value)
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const nonHanWords = words.filter((item) => !/\p{Script=Han}/u.test(item) && !stopWords.has(item)).length
  const hanCharacters = (normalized.match(/\p{Script=Han}/gu) ?? []).length
  return nonHanWords + Math.ceil(hanCharacters / 2)
}

export function boundCognitiveHistory(history: readonly CognitiveHistoryMessage[]): CognitiveHistoryMessage[] {
  if (!Array.isArray(history)) throw new TypeError('Invalid cognitive history.')
  const selected: CognitiveHistoryMessage[] = []
  const seen = new Set<string>()
  let budget = COGNITIVE_HISTORY_LIMIT_CHARACTERS
  const recent = history.slice(-COGNITIVE_HISTORY_LIMIT_MESSAGES)
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]
    if (!message || !isCognitiveUuid(message.id) || typeof message.body !== 'string' || message.body.length > 20_000 || (message.role !== 'user' && message.role !== 'assistant')) {
      throw new TypeError('Invalid cognitive history.')
    }
    if (seen.has(message.id) || message.body.length > budget) break
    seen.add(message.id)
    selected.push({ id: message.id, role: message.role, body: message.body })
    budget -= message.body.length
  }
  return selected.reverse()
}

function uncertaintyFor(intent: CognitiveIntent, confidence: number, alternatives: CognitiveIntent[], content: string): Exclude<CognitiveUncertainty, 'not_scored'> {
  if (intent === 'uncertain' || confidence < 50 || /(?:\b(?:said no one ever|said nobody ever|yeah right|as if)\b|🙃|😏|🙄)/iu.test(content)) return 'high'
  if (confidence < 72 || alternatives.length > 0) return 'medium'
  return 'low'
}

export interface CognitiveTurnReading {
  analysis: CognitiveTurnAnalysis
  decision: IntentDecision
  /**
   * Multi-signal reading (B1). Computed at decision time from the signals that
   * actually exist; `missing` says which ones did not. It is not persisted as a
   * calibrated probability because it is not one.
   */
  assessment: IntentAssessment
}

/**
 * Reads a turn once and returns both the persisted analysis and the Phase-2
 * intent decision. The decision is the single source of the intent; the
 * analysis carries the legacy label so stored records stay valid.
 */
export function analyzeCognitiveTurnDetailed(
  content: string,
  history: readonly CognitiveHistoryMessage[],
  sourceMessageId: string
): CognitiveTurnReading {
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > 8000 || !isCognitiveUuid(sourceMessageId)) {
    throw new TypeError('Invalid cognitive turn input.')
  }
  const current = normalize(stripQuotedAndReportedText(content))
  const boundedHistory = boundCognitiveHistory(history)
  const priorUser = [...boundedHistory].reverse().find((message) => message.role === 'user')
  const decision = decideIntent({
    content: current,
    hasPriorTurn: Boolean(priorUser),
    priorUserBody: priorUser?.body ?? null
  })
  const reasons = new Set(decision.reasons)
  const signals: CognitiveTurnSignals = {
    correction: reasons.has('explicit_correction_marker'),
    negation: featurePatterns.negation.test(current),
    changedMind: reasons.has('changed_mind_marker'),
    explicitGoal: reasons.has('explicit_goal_statement'),
    explicitConstraint: featurePatterns.explicitConstraint.test(current),
    explicitMemoryRequest: featurePatterns.explicitMemoryRequest.test(current),
    explicitMemorySaveRequest: featurePatterns.explicitMemorySaveRequest.test(current),
    explicitSelfFact: featurePatterns.explicitSelfFact.test(current),
    topicSwitch: reasons.has('explicit_topic_switch')
  }

  const intent: CognitiveIntent = decision.legacyIntent
  const alternatives = decision.alternatives
    .map((label) => legacyIntentOf(label))
    .filter((candidate) => candidate !== intent)
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .slice(0, 2)
  const uncertainty = uncertaintyFor(intent, decision.confidence, alternatives, current)

  // A reference the analyzer actually resolved becomes the topic source; an
  // unresolved reference has no topic at all; everything else stands alone.
  const topicSource = decision.dependsOnPriorTurn && priorUser
    ? 'previous_user_message' as const
    : decision.intent === 'ambiguous'
      ? 'none' as const
      : 'current' as const
  const topicReferenceMessageId = topicSource === 'previous_user_message' ? priorUser!.id : null
  const correctionNeedsDetail = signals.correction && !signals.explicitSelfFact && !signals.changedMind && wordCount(current) <= 4
  // Only a *reference* we could not resolve asks for clarification. A plain
  // statement that matches no intent rule is answered, not interrogated.
  // B1: the weighted reading decides whether an ambiguous label may be answered
  // at all. Asking is the safe failure mode; guessing is not.
  const assessment = assessIntentConfidence(
    {
      rule: decision.confidence / 100,
      context: decision.dependsOnPriorTurn ? (priorUser ? 1 : 0.5) : 0.6,
      evidence: null,
      history: priorUser ? 1 : null
    },
    decision.alternatives.length
  )
  // The assessment is computed here so it is available at decision time, but it
  // does not yet override the strategy: making every `ambiguous` label ask for
  // clarification shifts the offline cognitive evaluation baseline, and that
  // threshold has to be recalibrated against labelled data first. Recorded as an
  // open item in the algorithm registry rather than silently changing behaviour.
  const strategy = reasons.has('reference_without_context') || correctionNeedsDetail
    ? 'clarify' as const
    // Asking is only worth the cost when the reading is a coin flip *and* the
    // turn would otherwise retrieve memory: a wrong recall silently feeds the
    // wrong fact into the answer, while a weak answer can be corrected next turn.
    //
    // `intent === 'uncertain'` was tried as an additional trigger and measured:
    // it drops the labelled corpus strategy accuracy from 1.000 to 0.885
    // (23/26) because those turns are labelled "answer". The data wins, so the
    // trigger is not enabled; the measurement is pinned in
    // `cognitive-turn-analyzer.test.ts` so a later change cannot flip it quietly.
    : assessment.needsClarification && decision.needsMemoryRetrieval
      ? 'clarify' as const
      : decision.needsMemoryRetrieval
        ? 'retrieve_memory' as const
        : 'answer' as const
  const evidence = createIntentEvidence(sourceMessageId, topicReferenceMessageId, decision.confidence, uncertainty)

  return {
    decision,
    assessment,
    analysis: {
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      analyzerVersion: COGNITIVE_ANALYZER_VERSION,
      intent,
      alternatives,
      confidenceScore: decision.confidence,
      confidenceBasis: 'unvalidated_rule_strength',
      uncertainty,
      strategy,
      topicSource,
      topicReferenceMessageId,
      signals,
      evidence
    }
  }
}

const legacyByLabel: Readonly<Record<IntentLabel, CognitiveIntent>> = {
  information_query: 'information_query',
  continuation: 'information_query',
  correction: 'correction',
  preference_expression: 'sharing',
  emotion_expression: 'venting',
  goal_or_plan: 'planning',
  new_topic: 'exploration',
  ambiguous: 'uncertain',
  self_fact: 'sharing',
  explanation: 'explanation',
  exploration: 'exploration',
  feedback: 'feedback'
}

function legacyIntentOf(label: IntentLabel): CognitiveIntent {
  return legacyByLabel[label]
}

export function analyzeCognitiveTurn(
  content: string,
  history: readonly CognitiveHistoryMessage[],
  sourceMessageId: string
): CognitiveTurnAnalysis {
  return analyzeCognitiveTurnDetailed(content, history, sourceMessageId).analysis
}

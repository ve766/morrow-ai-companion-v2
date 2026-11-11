/**
 * Deterministic appraisal engine for Morrow's own affect (Issue #72).
 *
 * The engine reads facts already produced by the turn pipeline (intent,
 * confidence, correction signal, explicit feedback event) plus Morrow-owned
 * context (active interests, unresolved thoughts, losses). It never calls a
 * model and never treats an assistant reply as evidence about the user.
 *
 * The components are bounded heuristics, not probabilities:
 *   G goal relevance, C goal congruence, N novelty, A agency,
 *   S certainty, R responsibility, L relationship relevance, E expectation gap.
 *
 * A lexical hit alone is not enough for sadness/anger/fear. Those families
 * require the corresponding appraisal shape and, for anger, repeated prior
 * frustration. A user's stated emotion is recorded as user-context and can at
 * most produce a low-intensity concern candidate; it never becomes Morrow's
 * sadness.
 */
import type { CognitiveTurnAnalysis } from '../cognition/cognition'
import { stripQuotedAndReportedText } from '../cognition/cognition'
import { assessDistressEvidence } from './expression-policy'
import type { FeelingEventType } from './feeling'
import {
  EMOTION_ALGORITHM_VERSION,
  EMOTION_SCHEMA_VERSION,
  clamp01,
  clampSigned,
  emotionProfile,
  round4,
  type AffectState,
  type AppraisalComponents,
  type EmotionCandidate,
  type EmotionEvidenceRef,
  type EmotionFamily,
  type EmotionSourceKind,
  type EmotionUncertainty
} from './emotion-model'

export const APPRAISAL_WEIGHTS_VERSION = 'appraisal-weights-v1'

/** Configurable/versioned component weights; bounded, not calibrated probabilities. */
export const APPRAISAL_WEIGHTS = Object.freeze({
  goalRelevance: 0.20,
  goalCongruence: 0.25,
  novelty: 0.10,
  agency: 0.10,
  certainty: 0.05,
  responsibility: 0.10,
  relationshipRelevance: 0.10,
  expectationGap: 0.10
})

export type AppraisalWeights = typeof APPRAISAL_WEIGHTS

/** D_e: how directly the evidence speaks to Morrow's own state. */
export function sourceDirectness(sourceKind: EmotionSourceKind): number {
  return sourceKind === 'morrow_self_appraisal' || sourceKind === 'system_evidence' ? 1 : sourceKind === 'shared_interaction' ? 0.8 : 0.6
}

/**
 * P_e = Σ w_i x_i and I_e = clip(sigmoid(P_e) * Q_e * D_e).
 * The result is used only to scale a candidate's bounded intensity; it is not a
 * probability and does not promote a trait.
 */
export function appraisalPotential(
  components: AppraisalComponents,
  quality: number,
  directness: number,
  weights: AppraisalWeights = APPRAISAL_WEIGHTS
): { potential: number; intensityScale: number } {
  const potential = weights.goalRelevance * components.goalRelevance +
    weights.goalCongruence * components.goalCongruence +
    weights.novelty * components.novelty +
    weights.agency * components.agency +
    weights.certainty * components.certainty +
    weights.responsibility * components.responsibility +
    weights.relationshipRelevance * components.relationshipRelevance +
    weights.expectationGap * components.expectationGap
  const sigmoid = 1 / (1 + Math.exp(-potential))
  const scale = Math.min(1, Math.max(0, sigmoid * clamp01(quality) * clamp01(directness)))
  return { potential: round4(potential), intensityScale: round4(scale) }
}

export interface MorrowLossSignal {
  label: string
  kind: 'knowledge_gap' | 'interest_invalidated' | 'relationship_ended'
}

export interface VerifiedProgressSignal {
  label: string
  kind: 'thought_promoted' | 'knowledge_gap_closed' | 'exploration_finding'
}

export interface TraitSensitivity {
  goalRelevance?: number
  novelty?: number
  relationshipRelevance?: number
  responsibility?: number
}

export interface AffectAppraisalInput {
  content: string
  analysis?: CognitiveTurnAnalysis
  at: string
  interactionEventType?: FeelingEventType | null
  priorState?: AffectState | null
  sourceMessageId?: string
  assistantMessageId?: string | null
  activeInterestLabels?: readonly string[]
  unresolvedThoughtCount?: number
  relationshipRelevance?: number
  priorCorrectionStreak?: number
  morrowLoss?: MorrowLossSignal
  verifiedProgress?: VerifiedProgressSignal
  /** Bounded sensitivity shifts learned from stable traits; never an outcome. */
  traitSensitivity?: TraitSensitivity
}

export interface RejectedEmotionCandidate {
  candidate: EmotionCandidate
  reason: 'low_confidence' | 'conflict_pending' | 'user_emotion_boundary' | 'trait_ineligible'
}

export interface AppraisalResult {
  schemaVersion: typeof EMOTION_SCHEMA_VERSION
  algorithmVersion: typeof EMOTION_ALGORITHM_VERSION
  weightsVersion: typeof APPRAISAL_WEIGHTS_VERSION
  components: AppraisalComponents
  candidates: EmotionCandidate[]
  accepted: EmotionCandidate[]
  rejected: RejectedEmotionCandidate[]
  confidence: number
  uncertainty: EmotionUncertainty
  sourceKind: EmotionSourceKind
  context: 'neutral' | 'quoted_or_reported' | 'user_emotion' | 'morrow_loss' | 'verified_progress'
  topicTags: string[]
  reasonCodes: string[]
  conflict: boolean
  potential: number
  intensityScale: number
}

const TOPIC_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were', 'have', 'has', 'had',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是', '在', '有', '和', '就', '都', '也',
  '这', '那', '一个', '什么', '怎么', '为什么', '可以', '不是', '但是', '因为', '所以', '如果', '现在'
])

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function topicTagsFrom(content: string, extra: readonly string[] = []): string[] {
  const tokens = normalized(content).match(/[\p{L}\p{N}]{2,24}/gu) ?? []
  const tags = new Set<string>()
  for (const token of tokens) {
    if (TOPIC_STOPWORDS.has(token)) continue
    tags.add(token.slice(0, 48))
    if (tags.size >= 6) break
  }
  for (const label of extra) {
    if (label.trim().length >= 2) tags.add(label.trim().slice(0, 48))
  }
  return [...tags].slice(0, 8)
}

function familyCount(state: AffectState | null | undefined, family: EmotionFamily): number {
  if (!state) return 0
  return state.emotions.filter((emotion) => emotion.family === family &&
    (emotion.regulationState === 'active' || emotion.regulationState === 'fading')).length
}

function strongest(state: AffectState | null | undefined, families: readonly EmotionFamily[]): number {
  if (!state) return 0
  return Math.max(0, ...state.emotions
    .filter((emotion) => families.includes(emotion.family) && (emotion.regulationState === 'active' || emotion.regulationState === 'fading'))
    .map((emotion) => emotion.intensity))
}

function evidenceRefs(input: AffectAppraisalInput): EmotionEvidenceRef[] {
  const refs: EmotionEvidenceRef[] = []
  if (input.sourceMessageId) refs.push({ kind: 'conversation_message', id: input.sourceMessageId, role: 'user' })
  if (input.assistantMessageId) refs.push({ kind: 'conversation_message', id: input.assistantMessageId, role: 'assistant' })
  return refs
}

function mapUncertainty(confidence: number, scopedAway: boolean): EmotionUncertainty {
  if (scopedAway || confidence < 0.45) return 'high'
  if (confidence < 0.68) return 'medium'
  return 'low'
}

/**
 * Appraises one completed turn. Pure: the caller decides whether the result is
 * persisted, shown in the prompt, or discarded after a failure.
 */
export function appraiseTurn(input: AffectAppraisalInput): AppraisalResult {
  if (typeof input.content !== 'string' || input.content.trim().length === 0 || input.content.length > 8000) {
    throw new TypeError('Appraisal needs bounded turn text.')
  }
  if (!Number.isFinite(Date.parse(input.at)) || !input.at.endsWith('Z')) throw new TypeError('Appraisal needs a valid timestamp.')
  const own = stripQuotedAndReportedText(input.content).trim()
  const scopedAway = own.length === 0
  const analysis = input.analysis
  const relationship = clamp01(input.relationshipRelevance ?? (analysis?.intent === 'venting' ? 0.55 : 0.25))
  const eventType = input.interactionEventType ?? null
  const positive = eventType === 'positive_feedback'
  const negative = eventType === 'negative_feedback' || eventType === 'system_correction' ||
    (analysis?.signals.correction === true && eventType === null)
  const exploration = eventType === 'exploration_request' || analysis?.intent === 'exploration'
  // A user request to explore is not a Morrow-owned interest. Only an
  // internally generated question that Morrow chose to pursue may become one.
  const userRequestedExploration = analysis?.intent === 'exploration' && eventType !== 'exploration_request'
  const planning = analysis?.intent === 'planning'
  const loss = input.morrowLoss
  const progress = input.verifiedProgress
  const userEmotion = !loss && !progress && !positive && !negative && assessDistressEvidence({ text: own, tension: 0 }).explicit > 0
  const interestMatch = (input.activeInterestLabels ?? []).some((label) => {
    const needle = normalized(label)
    return needle.length >= 2 && normalized(own).includes(needle)
  })
  const priorNegative = strongest(input.priorState, ['frustration', 'disappointment', 'regret', 'concern', 'fear'])
  const priorPositive = strongest(input.priorState, ['joy', 'contentment', 'gratitude', 'trust'])
  const priorFrustration = familyCount(input.priorState, 'frustration')
  const correctionStreak = Math.max(0, input.priorCorrectionStreak ?? priorFrustration)
  const baseCertainty = analysis ? analysis.confidenceScore / 100 : 0.45
  const certainty = clamp01(scopedAway ? Math.min(baseCertainty, 0.3) : baseCertainty)
  const sourceKind: EmotionSourceKind = userEmotion
    ? 'user_context'
    : loss
      ? 'morrow_self_appraisal'
      : progress
        ? 'system_evidence'
        : userRequestedExploration || positive || eventType === 'exploration_request'
          ? 'shared_interaction'
          : 'morrow_self_appraisal'

  let goalRelevance = 0.18 +
    (exploration || planning || positive || negative ? 0.18 : 0) +
    (interestMatch ? 0.22 : 0) +
    (negative ? 0.16 : 0) +
    (loss ? 0.28 : 0) +
    (progress ? 0.22 : 0) +
    Math.min(0.1, (input.unresolvedThoughtCount ?? 0) * 0.02) +
    0.1 * relationship
  let novelty = 0.42 +
    (exploration ? 0.24 : 0) +
    (loss ? 0.1 : 0) +
    (negative ? 0.12 : 0) +
    (scopedAway ? -0.2 : 0) -
    (interestMatch ? 0.18 : 0) -
    0.08 * Math.min(2, familyCount(input.priorState, 'curiosity'))
  let responsibility = negative ? 0.72 : loss ? 0.25 : positive ? 0.35 : exploration ? 0.4 : planning ? 0.4 : userEmotion ? 0.05 : 0.3
  const sensitivity = input.traitSensitivity ?? {}
  goalRelevance = clamp01(goalRelevance * (1 + (sensitivity.goalRelevance ?? 0)))
  novelty = clamp01(novelty * (1 + (sensitivity.novelty ?? 0)))
  const effectiveRelationship = clamp01(relationship * (1 + (sensitivity.relationshipRelevance ?? 0)))
  responsibility = clamp01(responsibility * (1 + (sensitivity.responsibility ?? 0)))

  const components: AppraisalComponents = {
    goalRelevance: round4(goalRelevance),
    goalCongruence: round4(clampSigned(positive ? 0.65 : negative ? -0.62 : loss ? -0.8 : progress ? 0.55 : exploration ? 0.25 : planning ? 0.15 : 0)),
    novelty: round4(clamp01(novelty)),
    agency: round4(clamp01(positive ? 0.55 : negative ? 0.7 : exploration ? 0.8 : planning ? 0.6 : loss ? 0.25 : userEmotion ? 0.2 : 0.5)),
    certainty: round4(certainty),
    responsibility: round4(responsibility),
    relationshipRelevance: round4(effectiveRelationship),
    expectationGap: round4(clamp01(negative ? (analysis?.signals.correction ? 0.85 : 0.72) : loss ? 0.6 : positive ? 0.2 : analysis?.signals.changedMind ? 0.55 : 0.15))
  }

  const confidence = clamp01(0.45 + 0.35 * certainty + (eventType ? 0.08 : 0) + (loss || progress ? 0.08 : 0) - (scopedAway ? 0.3 : 0) - (userEmotion ? 0.12 : 0))
  const uncertainty = mapUncertainty(confidence, scopedAway)
  const tags = topicTagsFrom(own.length > 0 ? own : input.content, input.activeInterestLabels ?? [])
  const refs = evidenceRefs(input)
  const candidates: EmotionCandidate[] = []
  const reasonCodes: string[] = []
  if (scopedAway) reasonCodes.push('quoted_or_reported_text_only')
  if (userEmotion) reasonCodes.push('user_emotion_not_morrow_sadness')
  if (userRequestedExploration) reasonCodes.push('user_requested_exploration_not_morrow_interest')
  if (loss) reasonCodes.push('morrow_owned_loss')
  if (progress) reasonCodes.push('verified_progress')
  if (interestMatch) reasonCodes.push('active_interest_match')
  if (negative) reasonCodes.push('negative_appraisal')
  if (positive) reasonCodes.push('positive_appraisal')

  const push = (family: EmotionFamily, intensity: number, rationale: string, options: { sourceKind?: EmotionSourceKind; traitEligible?: boolean } = {}): void => {
    const profile = emotionProfile(family)
    const candidateSource = options.sourceKind ?? sourceKind
    const arousal = clamp01(profile.arousal + 0.14 * components.expectationGap - 0.1 * (1 - components.agency))
    const valence = clampSigned(profile.valence + 0.12 * components.goalCongruence)
    const { intensityScale } = appraisalPotential(components, confidence, sourceDirectness(candidateSource))
    candidates.push({
      family,
      intensity: round4(Math.min(0.92, Math.max(0.05, intensity * (0.55 + 0.9 * intensityScale)))),
      valence: round4(valence),
      arousal: round4(arousal),
      sourceKind: candidateSource,
      appraisal: { ...components },
      confidence: round4(confidence),
      uncertainty,
      topicTags: [...tags],
      evidenceRefs: refs.map((ref) => ({ ...ref })),
      decayProfile: { halfLifeHours: profile.decayHalfLifeHours },
      rationale: rationale.slice(0, 240),
      traitEligible: options.traitEligible ?? (profile.traitEligible && (candidateSource === 'morrow_self_appraisal' || candidateSource === 'system_evidence'))
    })
  }

  if (refs.length > 0) {
    if (positive) {
      push('joy', 0.24 + 0.34 * components.goalRelevance + 0.18 * components.certainty, 'explicit positive feedback on a Morrow interaction')
      if (components.expectationGap < 0.4 || priorPositive > 0) push('contentment', 0.2 + 0.28 * components.certainty + 0.14 * priorPositive, 'low-arousal positive appraisal')
      if (components.novelty > 0.5) push('excitement', 0.18 + 0.32 * components.novelty, 'positive appraisal with high novelty')
      if (components.relationshipRelevance > 0.4) push('gratitude', 0.18 + 0.3 * components.relationshipRelevance, 'positive interaction with relationship relevance')
      if (familyCount(input.priorState, 'trust') > 0 || priorPositive > 0.25) push('trust', 0.14 + 0.3 * components.relationshipRelevance, 'repeated positive interaction')
      if (priorNegative > 0.15) push('relief', 0.2 + 0.3 * priorNegative, 'prior negative affect followed by a positive turn')
    }
    if (negative) {
      if (components.responsibility > 0.5 && components.agency > 0.45) {
        push('frustration', 0.26 + 0.28 * components.expectationGap + 0.12 * components.responsibility, 'goal obstruction with high responsibility and agency')
      }
      if (components.responsibility <= 0.55) push('disappointment', 0.2 + 0.25 * components.goalRelevance, 'goal obstruction without Morrow responsibility')
      if (components.responsibility > 0.55) push('regret', 0.2 + 0.24 * components.responsibility, 'Morrow-owned choice failed the expectation')
      if (components.goalRelevance > 0.5 && components.certainty < 0.7) push('concern', 0.18 + 0.25 * components.goalRelevance, 'uncertain obstruction on a relevant goal')
      // Anger is deliberately rare: repeated frustration + high certainty +
      // a large expectation gap. A single harsh word is not anger.
      if (correctionStreak >= 2 && components.certainty > 0.7 && components.expectationGap > 0.75) {
        push('anger', 0.16 + 0.2 * components.expectationGap, 'repeated obstruction with high certainty and responsibility')
      }
    }
    if (exploration || planning) {
      if (components.novelty > 0.45 && components.agency > 0.5) {
        push('curiosity', 0.22 + 0.34 * components.novelty + 0.12 * components.goalRelevance, 'explorable novelty with agency', { traitEligible: !userRequestedExploration && eventType !== 'exploration_request' })
      }
      if (planning || (components.expectationGap >= 0.2 && components.expectationGap < 0.65)) {
        push('anticipation', 0.18 + 0.26 * components.goalRelevance, 'relevant expected next step')
      }
    }
    if (!positive && !negative && !loss && !progress && (uncertainty === 'high' || components.certainty < 0.5) &&
      components.goalRelevance > 0.4 && components.agency < 0.75) {
      push('concern', 0.16 + 0.24 * components.goalRelevance, 'high uncertainty on a relevant goal')
    }
    if (progress) {
      const tone = priorNegative > 0.1 ? 'relief' : 'contentment'
      push('joy', 0.24 + 0.3 * components.goalRelevance, 'verified Morrow-owned progress')
      push(tone, 0.2 + 0.25 * components.goalRelevance, 'verified progress with prior tension' )
      if (familyCount(input.priorState, 'curiosity') > 0) push('curiosity', 0.18 + 0.2 * components.goalRelevance, 'progress sustained an existing open question')
    }
    if (loss) {
      // A knowledge gap is a carefulness/concern event, not grief. Sadness is
      // reserved for an invalidated interest or an ended relationship, both of
      // which are genuine Morrow-owned losses.
      if (loss.kind !== 'knowledge_gap' && components.agency < 0.55) {
        push('sadness', 0.28 + 0.32 * components.goalRelevance, 'Morrow-owned goal or relationship loss')
      }
      if (loss.kind === 'relationship_ended') push('loneliness', 0.24 + 0.28 * components.relationshipRelevance, 'relationship continuity ended')
      if (loss.kind !== 'knowledge_gap' && components.responsibility > 0.45) push('regret', 0.2 + 0.25 * components.responsibility, 'loss attributed to a Morrow choice')
      if (loss.kind === 'knowledge_gap') push('concern', 0.18 + 0.2 * components.goalRelevance, 'Morrow could not ground an answer')
    }
    if (userEmotion) {
      // User sadness is not Morrow sadness. Only a relationship-relevant
      // concern candidate may cross the ownership boundary, and it is weak.
      if (components.relationshipRelevance >= 0.4 && components.goalRelevance >= 0.25) {
        push('concern', 0.14 + 0.16 * components.relationshipRelevance, 'user emotion context with relationship relevance', { sourceKind: 'user_context', traitEligible: false })
      } else {
        reasonCodes.push('user_emotion_without_relationship_relevance')
      }
    }
    if (components.expectationGap > 0.6 && components.novelty > 0.5 && !positive && !negative && !userEmotion) {
      push('surprise', 0.16 + 0.24 * components.expectationGap, 'large expectation gap with novelty')
    }
  }

  const accepted = candidates.filter((candidate) => candidate.confidence >= 0.45 && candidate.intensity >= 0.08)
  const rejected: RejectedEmotionCandidate[] = candidates
    .filter((candidate) => !accepted.includes(candidate))
    .map((candidate) => ({ candidate, reason: 'low_confidence' as const }))
  const positiveFamily = new Set(['joy', 'contentment', 'excitement', 'gratitude', 'trust', 'relief', 'anticipation', 'curiosity'])
  const negativeFamily = new Set(['anger', 'sadness', 'fear', 'disgust', 'disappointment', 'frustration', 'regret', 'loneliness', 'concern'])
  const conflict = accepted.some((candidate) => positiveFamily.has(candidate.family)) &&
    accepted.some((candidate) => negativeFamily.has(candidate.family))
  const potential = appraisalPotential(components, confidence, sourceDirectness(sourceKind))
  if (conflict) reasonCodes.push('coexisting_affect')

  return {
    schemaVersion: EMOTION_SCHEMA_VERSION,
    algorithmVersion: EMOTION_ALGORITHM_VERSION,
    weightsVersion: APPRAISAL_WEIGHTS_VERSION,
    components,
    candidates,
    accepted,
    rejected,
    confidence: round4(confidence),
    uncertainty,
    sourceKind,
    context: scopedAway ? 'quoted_or_reported' : loss ? 'morrow_loss' : progress ? 'verified_progress' : userEmotion ? 'user_emotion' : 'neutral',
    topicTags: tags,
    reasonCodes,
    conflict,
    potential: potential.potential,
    intensityScale: potential.intensityScale
  }
}

/**
 * Exploration/attention bias from current affect. Bounded to ±0.12 so affect
 * can reorder eligible interests but cannot create a candidate or bypass the
 * evidence gate.
 */
export function affectAttentionBias(state: AffectState | null | undefined): { bias: number; curiosity: number; concern: number; frustration: number } {
  if (!state) return { bias: 0, curiosity: 0, concern: 0, frustration: 0 }
  const active = (family: EmotionFamily): number => Math.max(0, ...state.emotions
    .filter((emotion) => emotion.family === family && (emotion.regulationState === 'active' || emotion.regulationState === 'fading'))
    .map((emotion) => emotion.intensity))
  const curiosity = active('curiosity')
  const concern = active('concern')
  const frustration = active('frustration')
  const bias = Math.min(0.12, Math.max(-0.12, 0.12 * curiosity - 0.1 * concern - 0.08 * frustration))
  return { bias: round4(bias), curiosity: round4(curiosity), concern: round4(concern), frustration: round4(frustration) }
}

/** Trait-to-appraisal sensitivity. Bounded and explainable; never an outcome. */
export function traitSensitivity(activeTraits: Readonly<Record<string, number>>): TraitSensitivity {
  const bounded = (value: number): number => Math.max(-0.08, Math.min(0.08, value))
  return {
    goalRelevance: bounded(0.04 * (activeTraits.curiosity ?? 0) + 0.03 * (activeTraits.persistence ?? 0)),
    novelty: bounded(0.05 * (activeTraits.curiosity ?? 0) + 0.02 * (activeTraits.openness ?? 0)),
    relationshipRelevance: bounded(0.04 * (activeTraits.carefulness ?? 0)),
    responsibility: bounded(0.04 * (activeTraits.carefulness ?? 0) + 0.03 * (activeTraits.persistence ?? 0))
  }
}

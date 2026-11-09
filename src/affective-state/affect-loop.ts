/**
 * Production affect loop (Issue #72).
 *
 * Coordinates three ledgers that must not be conflated:
 *   - emotion events/projection (`EmotionService`);
 *   - Morrow-owned trait observations/revisions (`MorrowTraitService`);
 *   - verified intrinsic reward signals (`IntrinsicRewardService`).
 *
 * `preview` is pure with respect to the database: it reads prior state and
 * returns a draft the chat path may put in the prompt. `record...` commits the
 * draft with the assistant message, so a failed turn cannot leave an emotion or
 * trait behind.
 */
import type { SqliteDatabase } from '../persistence/database'
import type { EventLogService } from '../persistence/event-log'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'
import {
  createInitialAffectState,
  describeAffect,
  mergeEmotionCandidates,
  type AffectState,
  type EmotionCandidate
} from './emotion-model'
import {
  appraiseTurn,
  affectAttentionBias,
  traitSensitivity,
  type AffectAppraisalInput,
  type AppraisalResult,
  type MorrowLossSignal,
  type VerifiedProgressSignal
} from './appraisal-engine'
import { EmotionService, deterministicEmotionId, type EmotionEventDraft } from './emotion-service'
import { MorrowTraitService, counterObservationFromEmotion, traitObservationFromEmotion, type MorrowTraitRevision } from '../self-model/morrow-trait-service'
import { IntrinsicRewardService, rewardForPromotedThought, type RewardSignal } from '../self-model/intrinsic-reward'
import type { MorrowSelfState } from '../self-model/inner-cognition'
import type { FeelingEventType } from './feeling'
import { MoodService, describeMood, type MoodView } from './mood-service'

export interface AffectPreviewInput {
  content: string
  analysis?: CognitiveTurnAnalysis
  at: string
  turnId: string
  conversationId: string
  sourceMessageId: string
  interactionEventType?: FeelingEventType | null
  activeInterestLabels?: readonly string[]
  unresolvedThoughtCount?: number
  relationshipRelevance?: number
  priorCorrectionStreak?: number
}

export interface AffectPreview {
  state: AffectState
  appraisal: AppraisalResult
  draft: EmotionEventDraft
  promptLine: string
  traitLine: string
  bias: { bias: number; curiosity: number; concern: number; frustration: number; topicTags: string[] }
  mood: MoodView
}

export interface AffectRecordInput {
  draft: EmotionEventDraft
  assistantMessageId: string
  processedAt: string
}

export class AffectLoopService {
  readonly emotions: EmotionService
  readonly traits: MorrowTraitService
  readonly rewards: IntrinsicRewardService
  readonly mood: MoodService

  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly events?: EventLogService
  ) {
    this.emotions = new EmotionService(database, clock, makeId, events)
    this.traits = new MorrowTraitService(database, clock, makeId, events)
    this.rewards = new IntrinsicRewardService(database, clock, makeId)
    this.mood = new MoodService(database, clock)
  }

  get available(): boolean {
    return databaseIsAffectReady(this.database)
  }

  preview(input: AffectPreviewInput): AffectPreview {
    const prior = this.emotions.snapshot(input.at)
    const sensitivities = traitSensitivity(this.traits.activeStrengths())
    const appraisal = appraiseTurn({
      content: input.content,
      at: input.at,
      ...(input.analysis ? { analysis: input.analysis } : {}),
      ...(input.interactionEventType !== undefined ? { interactionEventType: input.interactionEventType } : {}),
      priorState: prior,
      sourceMessageId: input.sourceMessageId,
      assistantMessageId: null,
      ...(input.activeInterestLabels ? { activeInterestLabels: input.activeInterestLabels } : {}),
      ...(input.unresolvedThoughtCount !== undefined ? { unresolvedThoughtCount: input.unresolvedThoughtCount } : {}),
      ...(input.relationshipRelevance !== undefined ? { relationshipRelevance: input.relationshipRelevance } : {}),
      priorCorrectionStreak: input.priorCorrectionStreak ?? prior.emotions.filter((emotion) => emotion.family === 'frustration').length,
      traitSensitivity: sensitivities
    })
    const eventId = deterministicEmotionId(`affect-event:${input.turnId}`)
    const draft: EmotionEventDraft = {
      eventId,
      idempotencyKey: input.turnId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      assistantMessageId: null,
      occurredAt: input.at,
      sourceKind: appraisal.sourceKind,
      topicTags: appraisal.topicTags,
      appraisal,
      accepted: appraisal.accepted,
      confidence: appraisal.confidence,
      uncertainty: appraisal.uncertainty,
      conflict: appraisal.conflict
    }
    let previewIndex = 0
    const state = mergeEmotionCandidates({
      state: prior,
      candidates: appraisal.accepted,
      eventId,
      at: input.at,
      makeId: () => deterministicEmotionId(`${eventId}:preview:${previewIndex++}`)
    })
    return {
      state,
      appraisal,
      draft,
      promptLine: [describeMood(this.mood.snapshot(input.at)), describeAffect(state, input.content)].filter(Boolean).join(String.fromCharCode(10)),
      traitLine: this.traits.contextBlock(input.content),
      bias: { ...affectAttentionBias(state), topicTags: [...appraisal.topicTags] },
      mood: this.mood.snapshot(input.at)
    }
  }

  recordCompletedTurnInTransaction(input: AffectRecordInput): boolean {
    const draft: EmotionEventDraft = { ...input.draft, assistantMessageId: input.assistantMessageId }
    // Counter-evidence may only act on a trait that was already active before
    // this turn. Otherwise the promotion turn would immediately counter itself.
    const activeBefore = new Set(this.traits.active().filter((trait) => trait.status === 'active').map((trait) => trait.traitKey))
    const recorded = this.emotions.recordInTransaction(draft, input.assistantMessageId, input.processedAt)
    // Trait observations ride the same transaction as the emotion event. A
    // user-context or shared-interaction candidate is filtered inside the
    // mapper, so praise cannot become a Morrow trait.
    if (this.mood.available && input.draft.accepted.length > 0) {
      const weight = 0.55
      const valence = input.draft.accepted.reduce((sum, candidate) => sum + candidate.valence, 0) / input.draft.accepted.length
      const arousal = input.draft.accepted.reduce((sum, candidate) => sum + candidate.arousal, 0) / input.draft.accepted.length
      const tension = input.draft.accepted.reduce((sum, candidate) => sum + (candidate.valence < 0 ? candidate.intensity : 0), 0) / input.draft.accepted.length
      this.mood.applyEvent({ at: input.processedAt, valence, arousal, dominance: 0.5, tension, weight })
    }
    for (const candidate of input.draft.accepted) {
      const observation = traitObservationFromEmotion(candidate, {
        turnId: input.draft.idempotencyKey,
        conversationId: input.draft.conversationId,
        sourceMessageId: input.draft.sourceMessageId,
        sourceEventId: input.draft.eventId,
        at: input.processedAt
      })
      if (observation) this.traits.observeInTransaction(observation)
    }
    // A Morrow-owned failure appraisal is also counter-evidence for an already
    // active trait. It never creates a trait on its own; it can only weaken an
    // existing, independently promoted pattern.
    for (const candidate of input.draft.accepted) {
      const counter = counterObservationFromEmotion(candidate, {
        turnId: input.draft.idempotencyKey,
        conversationId: input.draft.conversationId,
        sourceMessageId: input.draft.sourceMessageId,
        sourceEventId: input.draft.eventId,
        at: input.processedAt
      })
      if (!counter || !activeBefore.has(counter.traitKey)) continue
      const active = this.traits.current(counter.traitKey)
      if (active?.status !== 'active') continue
      this.traits.addCounterEvidence(counter)
    }
    return recorded
  }

  /**
   * Records a real Morrow-owned loss outside a normal reply (for example a
   * knowledge gap discovered while grounding an answer). The source message is
   * required so the evidence is traceable; no assistant message is needed.
   */
  recordMorrowLoss(input: {
    loss: MorrowLossSignal
    conversationId: string
    turnId: string
    sourceMessageId: string
    at: string
  }): boolean {
    const appraisal = appraiseTurn({
      content: input.loss.label,
      at: input.at,
      sourceMessageId: input.sourceMessageId,
      morrowLoss: input.loss,
      relationshipRelevance: input.loss.kind === 'relationship_ended' ? 0.7 : 0.3
    })
    const eventId = deterministicEmotionId(`affect-loss:${input.turnId}:${input.loss.kind}:${input.loss.label}`)
    const draft: EmotionEventDraft = {
      eventId,
      idempotencyKey: deterministicEmotionId(`affect-loss-key:${input.turnId}:${input.loss.kind}:${input.loss.label}`),
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      assistantMessageId: null,
      occurredAt: input.at,
      sourceKind: appraisal.sourceKind,
      topicTags: appraisal.topicTags,
      appraisal,
      accepted: appraisal.accepted,
      confidence: appraisal.confidence,
      uncertainty: appraisal.uncertainty,
      conflict: appraisal.conflict
    }
    return this.database.transaction(() => {
      const recorded = this.emotions.record(draft, null, input.at)
      for (const candidate of draft.accepted) {
        const observation = traitObservationFromEmotion(candidate, {
          turnId: draft.idempotencyKey,
          conversationId: draft.conversationId,
          sourceMessageId: draft.sourceMessageId,
          sourceEventId: draft.eventId,
          at: input.at
        })
        if (observation) this.traits.observe(observation)
      }
      return recorded
    })
  }

  /**
   * Verified progress from a promoted thought; also records a positive affect
   * event. Reward, event log and trait/affect projection share one transaction:
   * if the affect event cannot commit, the reward rolls back instead of leaving
   * a half-written state. This is deliberately not a best-effort catch.
   */
  observeThoughtReviews(states: readonly MorrowSelfState[]): RewardSignal[] {
    const recorded: RewardSignal[] = []
    for (const state of states) {
      if (state.status !== 'active') continue
      const rewardInput = rewardForPromotedThought({
        stateId: state.id,
        score: state.score,
        independentContexts: state.independentContexts,
        evidenceIds: state.evidenceRefs.map((ref) => ref.messageId)
      })
      if (!rewardInput) continue
      const first = state.evidenceRefs[0]
      if (!first) continue
      try {
        const reward = this.database.transaction(() => {
          const row = this.rewards.record({
            kind: rewardInput.kind,
            sourceEventId: rewardInput.sourceEventId,
            magnitude: rewardInput.magnitude,
            evidenceRefs: rewardInput.evidenceRefs,
            at: state.updatedAt
          })
          if (!row) return null
          const appraisal = appraiseTurn({
            content: state.proposition,
            at: state.updatedAt,
            sourceMessageId: first.messageId,
            verifiedProgress: { label: state.proposition.slice(0, 64), kind: 'thought_promoted' },
            activeInterestLabels: [state.proposition.slice(0, 48)],
            priorState: this.emotions.snapshot(state.updatedAt)
          })
          const eventId = deterministicEmotionId(`affect-progress:${state.id}`)
          const draft: EmotionEventDraft = {
            eventId,
            idempotencyKey: deterministicEmotionId(`affect-progress-key:${state.id}`),
            conversationId: first.conversationId,
            sourceMessageId: first.messageId,
            assistantMessageId: null,
            occurredAt: state.updatedAt,
            sourceKind: appraisal.sourceKind,
            topicTags: appraisal.topicTags,
            appraisal,
            accepted: appraisal.accepted,
            confidence: appraisal.confidence,
            uncertainty: appraisal.uncertainty,
            conflict: appraisal.conflict
          }
          this.emotions.record(draft, null, state.updatedAt)
          return row
        })
        if (reward) recorded.push(reward)
      } catch {
        // No message text or ids are logged; the failed transaction is the
        // evidence, and no reward row survives.
        this.events?.tryRecord({
          sourceModule: 'cognition',
          eventType: 'affect.progress_commit_failed',
          actor: 'system',
          subjectType: 'morrow_self_state',
          subjectId: state.id,
          correlationId: null,
          payload: { reason: 'atomic_reward_affect_commit' }
        })
      }
    }
    return recorded
  }

  contextBlock(query: string): string {
    if (!this.available) return ''
    const state = this.emotions.snapshot(this.clock())
    return [describeAffect(state, query), this.traits.contextBlock(query)].filter(Boolean).join('\n\n')
  }

  attentionBias(): { bias: number; curiosity: number; concern: number; frustration: number } {
    if (!this.available) return { bias: 0, curiosity: 0, concern: 0, frustration: 0 }
    const base = affectAttentionBias(this.emotions.snapshot(this.clock()))
    const mood = this.mood.snapshot(this.clock())
    const moodBias = mood.available ? 0.05 * mood.state.valence + 0.03 * (mood.state.arousal - 0.35) : 0
    return { ...base, bias: Math.min(0.12, Math.max(-0.12, base.bias + moodBias)) }
  }

  activeEmotions(): Array<{ family: string; intensity: number; regulationState: string; sourceKind: string }> {
    return this.emotions.snapshot(this.clock()).emotions.map((emotion) => ({
      family: emotion.family,
      intensity: emotion.intensity,
      regulationState: emotion.regulationState,
      sourceKind: emotion.sourceKind
    }))
  }

  activeTraits(): MorrowTraitRevision[] {
    return this.traits.active()
  }

  regulate(emotionId: string, kind: 'reappraised' | 'regulated' | 'retracted', rationale: string): AffectState {
    return this.emotions.regulate({ emotionId, kind, rationale })
  }

  clearAll(): void {
    this.emotions.clearHistory(this.clock())
    this.traits.clearAll(this.clock())
    this.rewards.clearAll()
    if (this.mood.available) this.mood.clear(this.clock())
  }

  deleteConversation(conversationId: string): void {
    this.emotions.deleteConversation(conversationId, this.clock())
    this.traits.deleteConversation(conversationId, this.clock())
  }
}

function databaseIsAffectReady(database: SqliteDatabase): boolean {
  if (database.schemaVersion < 55 || !database.cognitivePersistenceAvailable) return false
  try {
    return Number(database.connection.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('emotion_events', 'emotion_states', 'morrow_trait_observations', 'morrow_trait_revisions', 'reward_signals')"
    ).get()?.count ?? 0) === 5
  } catch {
    return false
  }
}

/** Exported for tests/reports; the projection of a preview's candidates. */
export function previewStateForCandidates(input: {
  prior: AffectState | null
  candidates: readonly EmotionCandidate[]
  eventId: string
  at: string
}): AffectState {
  let index = 0
  return mergeEmotionCandidates({
    state: input.prior ?? createInitialAffectState(input.at),
    candidates: input.candidates,
    eventId: input.eventId,
    at: input.at,
    makeId: () => deterministicEmotionId(`${input.eventId}:preview:${index++}`)
  })
}

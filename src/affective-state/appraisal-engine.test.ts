import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import { appraiseTurn, affectAttentionBias, traitSensitivity } from './appraisal-engine'
import { createInitialAffectState, mergeEmotionCandidates, type EmotionCandidate } from './emotion-model'
import { deterministicEmotionId } from './emotion-service'

const at = '2026-11-08T02:00:00.000Z'

function analysis(content: string) {
  return analyzeCognitiveTurn(content, [], randomUUID())
}

function priorWith(family: 'frustration' | 'concern' | 'joy', intensity: number) {
  const candidate: EmotionCandidate = {
    family,
    intensity,
    valence: family === 'joy' ? 0.7 : -0.5,
    arousal: 0.6,
    sourceKind: 'morrow_self_appraisal',
    appraisal: { goalRelevance: 0.7, goalCongruence: family === 'joy' ? 0.6 : -0.6, novelty: 0.4, agency: 0.7, certainty: 0.7, responsibility: 0.7, relationshipRelevance: 0.3, expectationGap: 0.7 },
    confidence: 0.8,
    uncertainty: 'low',
    topicTags: ['database'],
    evidenceRefs: [{ kind: 'conversation_message', id: randomUUID(), role: 'user' }],
    decayProfile: { halfLifeHours: 12 },
    rationale: 'seed',
    traitEligible: true
  }
  let index = 0
  return mergeEmotionCandidates({
    state: createInitialAffectState(at),
    candidates: [candidate],
    eventId: randomUUID(),
    at,
    makeId: () => deterministicEmotionId(`prior-${index++}`)
  })
}

describe('affect appraisal boundaries', () => {
  it('does not turn a user sadness statement into Morrow sadness', () => {
    const content = '我很难过，感觉整个人都撑不住了。'
    const result = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'user_context', sourceMessageId: randomUUID() })
    expect(result.accepted.some((candidate) => candidate.family === 'sadness')).toBe(false)
    expect(result.accepted.every((candidate) => candidate.sourceKind === 'user_context')).toBe(true)
    expect(result.reasonCodes).toContain('user_emotion_not_morrow_sadness')
  })

  it('treats quoted and reported emotion as non-evidence', () => {
    for (const content of ['“我很难过”', '他说他很难过，整个人都撑不住了。']) {
      const result = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'user_context', sourceMessageId: randomUUID() })
      expect(result.accepted.some((candidate) => candidate.family === 'sadness')).toBe(false)
    }
  })

  it('requires repeated frustration before even a candidate anger', () => {
    const content = 'Your answer was wrong and not helpful. Please recheck the database conclusion.'
    const single = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'system_correction', sourceMessageId: randomUUID() })
    expect(single.accepted.some((candidate) => candidate.family === 'anger')).toBe(false)
    expect(single.accepted.some((candidate) => candidate.family === 'frustration')).toBe(true)
    const repeated = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'system_correction', sourceMessageId: randomUUID(), priorCorrectionStreak: 3 })
    expect(repeated.accepted.some((candidate) => candidate.family === 'anger')).toBe(true)
  })

  it('does not manufacture fear from ordinary uncertainty', () => {
    const content = '我不确定这个 API 的参数应该怎么填。'
    const result = appraiseTurn({ content, analysis: analysis(content), at, sourceMessageId: randomUUID() })
    expect(result.accepted.some((candidate) => candidate.family === 'fear')).toBe(false)
  })

  it('allows a weak concern for relationship-relevant user distress, still marked user-context', () => {
    const content = '我很难过。'
    const result = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'user_context', sourceMessageId: randomUUID(), relationshipRelevance: 0.8 })
    const concern = result.accepted.find((candidate) => candidate.family === 'concern')
    expect(concern?.sourceKind).toBe('user_context')
    expect(concern?.traitEligible).toBe(false)
  })

  it('does not treat sarcasm, polite refusal or a bare thanks as a negative appraisal', () => {
    for (const content of ['Yeah right, great answer 🙄', '不用了，谢谢。']) {
      const result = appraiseTurn({ content, analysis: analysis(content), at, sourceMessageId: randomUUID() })
      expect(result.accepted.some((candidate) => ['anger', 'sadness', 'frustration', 'fear'].includes(candidate.family))).toBe(false)
    }
    const thanks = appraiseTurn({ content: '谢谢。', analysis: analysis('谢谢。'), at, interactionEventType: 'positive_feedback', sourceMessageId: randomUUID() })
    expect(thanks.accepted.some((candidate) => candidate.family === 'joy')).toBe(true)
  })

  it('does not turn a user-requested exploration into a Morrow-owned trait source even without an explicit feedback event', () => {
    const content = '我想继续探索分布式系统的共识算法。'
    const base = analysis(content)
    const result = appraiseTurn({ content, analysis: { ...base, intent: 'exploration' }, at, sourceMessageId: randomUUID() })
    const curiosity = result.accepted.find((candidate) => candidate.family === 'curiosity')
    if (curiosity) {
      expect(curiosity.sourceKind).toBe('shared_interaction')
      expect(curiosity.traitEligible).toBe(false)
    }
    expect(result.reasonCodes).toContain('user_requested_exploration_not_morrow_interest')
  })

  it('marks exploration curiosity as shared rather than a Morrow-owned trait evidence source', () => {
    const content = '我想继续探索分布式系统的共识算法。'
    const result = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'exploration_request', sourceMessageId: randomUUID() })
    const curiosity = result.accepted.find((candidate) => candidate.family === 'curiosity')
    expect(curiosity?.sourceKind).toBe('shared_interaction')
    expect(curiosity?.traitEligible).toBe(false)
  })

  it('marks a knowledge gap as a Morrow-owned concern and never as grief', () => {
    const content = '蛋白质折叠'
    const result = appraiseTurn({ content, analysis: analysis(content), at, sourceMessageId: randomUUID(), morrowLoss: { label: content, kind: 'knowledge_gap' } })
    expect(result.accepted.some((candidate) => candidate.family === 'concern' && candidate.traitEligible)).toBe(true)
    expect(result.accepted.some((candidate) => candidate.family === 'sadness')).toBe(false)
  })

  it('produces relief after prior tension and keeps the affect bias bounded', () => {
    const prior = priorWith('concern', 0.6)
    const content = '谢谢，这次核对通过了。'
    const result = appraiseTurn({ content, analysis: analysis(content), at, interactionEventType: 'positive_feedback', sourceMessageId: randomUUID(), priorState: prior })
    expect(result.accepted.some((candidate) => candidate.family === 'relief')).toBe(true)
    const bias = affectAttentionBias(prior)
    expect(Math.abs(bias.bias)).toBeLessThanOrEqual(0.12)
  })

  it('keeps trait sensitivity bounded and explainable', () => {
    const sensitivity = traitSensitivity({ curiosity: 1, carefulness: 1, persistence: 1, openness: 1 })
    for (const value of Object.values(sensitivity)) expect(Math.abs(value ?? 0)).toBeLessThanOrEqual(0.08)
  })
})

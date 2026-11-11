import { describe, expect, it } from 'vitest'
import { decideIntent, isIntentDecision, type IntentDecision } from './intent-decision'

const decide = (content: string, hasPriorTurn = false): IntentDecision => decideIntent({ content, hasPriorTurn })

describe('phase 2 B: intent decision', () => {
  it.each([
    ['information_query', '我住在哪里？', false],
    ['continuation', '那后来呢？', true],
    ['correction', '我刚才说错了，我住在大阪。', false],
    ['preference_expression', '我喜欢猫。', false],
    ['emotion_expression', '我最近很焦虑，压力很大。', false],
    ['goal_or_plan', '我计划明年换工作。', false],
    ['new_topic', '换个话题，帮我看看排序算法。', true],
    ['ambiguous', '嗯。', false]
  ] as const)('classifies %s', (intent, content, hasPriorTurn) => {
    const decision = decide(content, hasPriorTurn)
    expect(decision.intent, content).toBe(intent)
    expect(decision.reasons.length).toBeGreaterThan(0)
    expect(isIntentDecision(decision)).toBe(true)
  })

  it('reports the four routing questions for every decision', () => {
    const correction = decide('我刚才说错了，我住在大阪。')
    expect(correction).toMatchObject({
      needsMemoryRetrieval: true,
      dependsOnPriorTurn: false,
      mayProduceMemoryCandidate: true
    })

    const preference = decide('我喜欢猫。')
    // A single preference expression may only become a *candidate*, and it is
    // answered first: related preference history is attached "on demand" by
    // the retrieval policy, not by a forced lookup route.
    expect(preference).toMatchObject({ intent: 'preference_expression', mayProduceMemoryCandidate: true, needsMemoryRetrieval: false })

    const emotion = decide('我最近很焦虑，压力很大。')
    // An emotion turn does not pull private memories on its own.
    expect(emotion).toMatchObject({ intent: 'emotion_expression', needsMemoryRetrieval: false, mayProduceMemoryCandidate: false })

    const topic = decide('换个话题，帮我看看排序算法。', true)
    expect(topic).toMatchObject({ intent: 'new_topic', needsMemoryRetrieval: false, dependsOnPriorTurn: false })
  })

  it('asks instead of guessing when a reference has no context', () => {
    const decision = decide('那怎么办？', false)
    expect(decision).toMatchObject({ intent: 'ambiguous', dependsOnPriorTurn: true })
    expect(decision.reasons).toContain('reference_without_context')
    expect(decision.confidenceLevel).not.toBe('high')

    const withContext = decide('那怎么办？', true)
    expect(withContext.intent).toBe('continuation')
    expect(withContext.dependsOnPriorTurn).toBe(true)
  })

  it('keeps a hypothesis out of the preference class', () => {
    const hypothetical = decide('如果我喜欢猫呢？')
    expect(hypothetical.intent).toBe('information_query')
    expect(hypothetical.reasons).toContain('hypothetical_or_reported')
    expect(decide('我住在哪个城市？').intent).toBe('information_query')
  })

  it('does not let a single keyword decide the intent', () => {
    // 猫 alone matches no rule; a bare noun is not an intent.
    expect(decide('猫')).toMatchObject({ intent: 'ambiguous', confidenceLevel: 'low' })
    expect(decide('猫').reasons).toContain('no_rule_matched')
    // One weak predicate cue is capped instead of being reported as certain.
    const weak = decide('我对花生过敏。')
    expect(weak.confidenceLevel).not.toBe('high')
    expect(weak.reasons).toContain('single_weak_signal')
  })

  it('maps every label onto the persisted legacy intent', () => {
    expect(decide('我喜欢猫。').legacyIntent).toBe('sharing')
    expect(decide('我最近很焦虑，压力很大。').legacyIntent).toBe('venting')
    expect(decide('我计划明年换工作。').legacyIntent).toBe('planning')
    expect(decide('那后来呢？', true).legacyIntent).toBe('information_query')
    expect(decide('嗯。').legacyIntent).toBe('uncertain')
  })

  it('rejects malformed decisions', () => {
    expect(isIntentDecision(null)).toBe(false)
    expect(isIntentDecision({ ...decide('我喜欢猫。'), intent: 'made_up' })).toBe(false)
    expect(isIntentDecision({ ...decide('我喜欢猫。'), reasons: ['Not A Code'] })).toBe(false)
    expect(isIntentDecision({ ...decide('我喜欢猫。'), confidence: 101 })).toBe(false)
  })
})

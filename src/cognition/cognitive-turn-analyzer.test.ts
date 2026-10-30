import { describe, expect, it } from 'vitest'
import { analyzeCognitiveTurn, analyzeCognitiveTurnDetailed, boundCognitiveHistory } from './cognitive-turn-analyzer'
import type { CognitiveHistoryMessage } from './cognition'

const sourceId = '00000000-0000-4000-8000-000000000100'
const priorId = '00000000-0000-4000-8000-000000000101'

function analyze(content: string, history: CognitiveHistoryMessage[] = [], messageId = sourceId) {
  return analyzeCognitiveTurn(content, history, messageId)
}

describe('B1 confidence drives the strategy', () => {
  it('scores the same reading identically under no, unrelated and related history', () => {
    // The old model scored this turn 0.780 without history and 0.947 with any
    // history. Presence of history must not be worth anything by itself.
    const without = analyzeCognitiveTurnDetailed('我住在哪里？', [], sourceId)
    const unrelated = analyzeCognitiveTurnDetailed('我住在哪里？', [{ id: priorId, role: 'user', body: '帮我看看这道数学题。' }], sourceId)
    const related = analyzeCognitiveTurnDetailed('我住在哪里？', [{ id: priorId, role: 'user', body: '我最近在找杭州的房子。' }], sourceId)
    expect(without.assessment.topScore).toBe(unrelated.assessment.topScore)
    expect(without.assessment.topScore).toBe(related.assessment.topScore)
    // …and the user-visible route is the same in all three.
    expect(new Set([without.analysis.strategy, unrelated.analysis.strategy, related.analysis.strategy])).toEqual(new Set(['retrieve_memory']))
  })

  it('asks when a reference cannot be resolved at all', () => {
    const reading = analyzeCognitiveTurnDetailed('那个怎么办？', [], sourceId)
    // The unresolved reference is a precondition gate, not a score penalty.
    expect(reading.assessment.reasons).toContain('unresolved_reference')
    expect(reading.assessment.needsClarification).toBe(true)
    expect(reading.analysis.strategy).toBe('clarify')
  })

  it('answers the same turn once the reference resolves against a related prior turn', () => {
    const reading = analyzeCognitiveTurnDetailed('那个怎么办？', [{ id: priorId, role: 'user', body: '我的租房合同下周到期。' }], sourceId)
    expect(reading.assessment.needsClarification).toBe(false)
    expect(reading.analysis.strategy).not.toBe('clarify')
  })

  it('does not ask about a vague turn that has no competing reading', () => {
    const reading = analyzeCognitiveTurnDetailed('嗯。', [], sourceId)
    expect(reading.assessment.candidates).toHaveLength(0)
    expect(reading.assessment.needsClarification).toBe(false)
    expect(reading.analysis.strategy).toBe('answer')
  })

  it('lets an explicit correction override a context-derived reading', () => {
    const reading = analyzeCognitiveTurnDetailed('我说的是上海。', [{ id: priorId, role: 'user', body: '你住在北京对吧？' }], sourceId)
    expect(reading.analysis.strategy).not.toBe('clarify')
    expect(reading.analysis.signals.correction).toBe(true)
  })

  it('keeps the strategy stable for a clear request regardless of history', () => {
    const without = analyzeCognitiveTurnDetailed('帮我制定下周的学习计划，预算三千。', [], sourceId)
    const withHistory = analyzeCognitiveTurnDetailed('帮我制定下周的学习计划，预算三千。', [{ id: priorId, role: 'user', body: '今天股市怎么样？' }], sourceId)
    expect(without.analysis.strategy).toBe('retrieve_memory')
    expect(withHistory.analysis.strategy).toBe(without.analysis.strategy)
  })
})

describe('local cognitive turn analysis', () => {
  it.each([
    ['information_query', '我上周告诉过你我的生日吗？'],
    ['explanation', '为什么天空是蓝色的？'],
    ['venting', '我最近很焦虑，工作压力很大。'],
    ['feedback', '这个回答很有帮助，谢谢。'],
    ['correction', '不对，我住在上海，不是北京。'],
    ['exploration', '我们一起头脑风暴周末可以做什么。'],
    ['planning', '帮我制定下周旅行计划，预算不要超过三千。'],
    ['uncertain', '嗯。']
  ] as const)('classifies %s from explicit local cues', (intent, content) => {
    expect(analyze(content).intent).toBe(intent)
  })

  it('marks confidence as uncalibrated rule strength and never treats inferred intent as a user fact', () => {
    const result = analyze('Why is the sky blue?')
    expect(result.confidenceBasis).toBe('unvalidated_rule_strength')
    expect(result.evidence).toMatchObject({
      source: 'local_rules',
      status: 'observation',
      confidenceBasis: 'unvalidated_rule_strength',
      requiresUserConfirmation: true,
      changeReason: 'rule_inference'
    })
    expect(result.evidence.evidenceRefs).toEqual([{ kind: 'conversation_message', id: sourceId, revision: null }])
  })

  it('detects corrections, negation, changed mind, explicit goals and constraints without writing memory', () => {
    const correction = analyze('不对，我住在上海，不是北京。')
    expect(correction.signals).toMatchObject({ correction: true, negation: true })
    expect(correction.strategy).toBe('retrieve_memory')

    const changedMind = analyze('我改主意了，还是坐火车吧。')
    expect(changedMind.signals.changedMind).toBe(true)
    expect(changedMind.intent).toBe('correction')

    const plan = analyze('I want to finish the draft by Friday, but do not schedule work after 8 pm.')
    expect(plan).toMatchObject({ intent: 'planning', signals: { explicitGoal: true, explicitConstraint: true, negation: true } })
    expect(plan.evidence.requiresUserConfirmation).toBe(true)
  })

  it('does not classify quoted or clearly reported correction and affect words as the current user intent', () => {
    const quotedCorrection = analyze('Translate this quote: “You misunderstood me; your answer was wrong.”')
    expect(quotedCorrection.intent).toBe('uncertain')
    expect(quotedCorrection.signals.correction).toBe(false)

    const reportedAffect = analyze('My friend said that I feel sad and overwhelmed; I am only quoting them.')
    expect(reportedAffect.intent).toBe('uncertain')

    const reportedAffectChinese = analyze('朋友说我很难过，我只是在转述这句话。')
    expect(reportedAffectChinese.intent).toBe('uncertain')
  })

  it('uses only the latest bounded user message to resolve a follow-up and retrieve its related memory', () => {
    const result = analyze('那我之前说的茶呢？', [
      { id: priorId, role: 'user', body: 'I prefer jasmine tea.' },
      { id: '00000000-0000-4000-8000-000000000102', role: 'assistant', body: 'Understood.' }
    ])
    expect(result).toMatchObject({
      intent: 'information_query',
      strategy: 'retrieve_memory',
      topicSource: 'previous_user_message',
      topicReferenceMessageId: priorId
    })
  })

  it('treats a short follow-up without deictic words as a reference to the previous user message', () => {
    const followUp = analyze('那后天呢？', [{ id: priorId, role: 'user', body: '我下周要去杭州出差。' }])
    expect(followUp).toMatchObject({
      topicSource: 'previous_user_message',
      topicReferenceMessageId: priorId
    })
    // Without any prior message there is nothing to resolve, so it must ask.
    expect(analyze('那后天呢？')).toMatchObject({ strategy: 'clarify', topicReferenceMessageId: null })
  })

  it('asks for clarification for unresolved references and does not reuse a prior topic after an explicit topic switch', () => {
    expect(analyze('那怎么办？')).toMatchObject({ strategy: 'clarify', topicSource: 'none', topicReferenceMessageId: null })

    const switched = analyze('换个话题，解释量子纠缠。', [
      { id: priorId, role: 'user', body: 'I prefer jasmine tea.' }
    ])
    expect(switched).toMatchObject({ topicSource: 'current', topicReferenceMessageId: null, signals: { topicSwitch: true } })
  })

  it('keeps only the most recent bounded history and rejects invalid inputs', () => {
    const history = Array.from({ length: 15 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      body: `message ${index}`
    }))
    const bounded = boundCognitiveHistory(history)
    expect(bounded).toHaveLength(12)
    expect(bounded[0]?.body).toBe('message 3')
    expect(bounded.at(-1)?.body).toBe('message 14')
    expect(() => analyze('   ', [], sourceId)).toThrow('Invalid cognitive turn input.')
    expect(() => analyze('valid', [], 'invalid-id')).toThrow('Invalid cognitive turn input.')
  })
})

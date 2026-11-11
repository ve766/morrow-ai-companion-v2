import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decideExploration } from './exploration-policy'
import type { InterestRecord } from './self-model-domain'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import { deriveExpressionPolicy } from '../affective-state/expression-policy'

const now = '2026-11-08T04:00:00.000Z'

function interest(label: string, strength: number, terms: string[]): InterestRecord {
  return {
    id: randomUUID(),
    label,
    status: 'active',
    origin: 'morrow',
    evidenceCount: 5,
    conversationCount: 3,
    strength,
    confidence: 80,
    sourceMessageId: randomUUID(),
    conversationId: randomUUID(),
    firstSeenAt: now,
    lastSeenAt: now,
    updatedAt: now,
    terms
  }
}

describe('affect as a bounded attention signal', () => {
  it('reorders only a topic-related eligible interest, never an unrelated one', () => {
    const database = interest('数据库查询优化', 0.80, ['数据库', '查询'])
    const cooking = interest('烘焙面包的温度', 0.79, ['烘焙', '面包'])
    const base = decideExploration({ interests: [database, cooking], now, lastRaisedAt: null, raisedLastDay: 0, turn: null })
    expect(base.interestId).toBe(database.id)
    const biased = decideExploration({
      interests: [database, cooking], now, lastRaisedAt: null, raisedLastDay: 0, turn: null,
      affectBias: { bias: 0.12, topicTags: ['烘焙'] }
    })
    expect(biased.interestId).toBe(cooking.id)
    const unrelated = decideExploration({
      interests: [database, cooking], now, lastRaisedAt: null, raisedLastDay: 0, turn: null,
      affectBias: { bias: 0.12, topicTags: ['太阳系'] }
    })
    expect(unrelated.interestId).toBe(database.id)
  })

  it('does not let affect create or bypass the evidence gate', () => {
    const weak = interest('数据库查询优化', 0.3, ['数据库'])
    const decision = decideExploration({ interests: [weak], now, lastRaisedAt: null, raisedLastDay: 0, turn: null, affectBias: { bias: 0.12, topicTags: ['数据库'] } })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('insufficient_evidence')
  })

  it('changes the expression strategy for relevant affect but yields to an explicit direct request', () => {
    const analysis = analyzeCognitiveTurn('请给出一个方案。', [], randomUUID())
    const repair = deriveExpressionPolicy({ state: null, analysis, wantsDirectAnswer: false, text: '请给出一个方案。', affectFamilies: ['frustration'] })
    expect(repair.affectStrategy).toBe('repair')
    const unrelated = deriveExpressionPolicy({ state: null, analysis, wantsDirectAnswer: false, text: '请给出一个方案。', affectFamilies: ['joy'] })
    expect(unrelated.affectStrategy).toBeNull()
    const direct = deriveExpressionPolicy({ state: null, analysis, wantsDirectAnswer: true, text: '直接给我方案', affectFamilies: ['frustration'] })
    expect(direct.adviceMode).toBe('answer_directly')
    expect(direct.affectStrategy).toBeNull()
  })
})

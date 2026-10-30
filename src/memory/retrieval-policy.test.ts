import { describe, expect, it } from 'vitest'
import { MemoryContextAssembler } from './memory-context-assembler'
import type { MemoryRecord } from './memory-domain'
import { policyForIntent } from './retrieval-policy'

function memory(id: string, text: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    originalText: text,
    currentText: text,
    sourceCategory: 'user_explicit_input',
    status: 'active',
    sensitivity: 'personal',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    revision: 1,
    confidence: 85,
    lastConfirmedAt: '2026-10-20T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}

const assembler = new MemoryContextAssembler()
const ids = (texts: string[]): string[] => texts.map((_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`)

describe('phase 2 C: retrieval policy narrows, never widens', () => {
  it('gives every intent an explicit policy', () => {
    for (const intent of ['information_query', 'continuation', 'correction', 'preference_expression', 'emotion_expression', 'goal_or_plan', 'new_topic', 'ambiguous', 'self_fact', 'explanation', 'exploration', 'feedback'] as const) {
      const policy = policyForIntent(intent)
      expect(policy.intent).toBe(intent)
      expect(policy.maxMemories).toBeGreaterThanOrEqual(0)
      expect(policy.reason.length).toBeGreaterThan(0)
    }
  })

  it('delivers no saved memory for a feedback turn', () => {
    const [id] = ids(['我喜欢咖啡。'])
    const result = assembler.assemble('这个回答很有帮助，谢谢。', [memory(id!, '我喜欢咖啡。')], 'personal', 25, 3000, undefined, policyForIntent('feedback'))
    expect(result.selected).toEqual([])
  })

  it('limits an emotion turn to continuity and never drags in unrelated private facts', () => {
    const [coffee, cat] = ids(['我喜欢咖啡。', '我养了一只叫咪咪的猫。'])
    const records = [memory(coffee!, '我喜欢咖啡。'), memory(cat!, '我养了一只叫咪咪的猫。')]
    const policy = policyForIntent('emotion_expression')
    expect(policy.maxMemories).toBe(3)
    // "今天很累" shares no content with either memory.
    expect(assembler.assemble('我今天很累。', records, 'personal', 25, 3000, undefined, policy).selected).toEqual([])
    // Continuity still works when the turn mentions the topic.
    expect(assembler.assemble('咖啡喝多了有点难受。', records, 'personal', 25, 3000, undefined, policy).selected.map((item) => item.id)).toEqual([coffee])
  })

  it('restricts a preference turn to preference evidence', () => {
    const [coffee, city] = ids(['我喜欢咖啡。', '我住在杭州。'])
    const records = [memory(coffee!, '我喜欢咖啡。'), memory(city!, '我住在杭州。')]
    const result = assembler.assemble('咖啡和杭州我都喜欢。', records, 'personal', 25, 3000, undefined, policyForIntent('preference_expression'))
    expect(result.selected.map((item) => item.id)).toEqual([coffee])
  })

  it('keeps a contradicting record for a correction but not for a new topic', () => {
    const [hangzhou] = ids(['我住在杭州。'])
    const records = [memory(hangzhou!, '我住在杭州。')]
    const correction = assembler.assemble('我住在大阪。', records, 'personal', 25, 3000, undefined, policyForIntent('correction'))
    expect(correction.selected.map((item) => item.id)).toEqual([hangzhou])
    const newTopic = assembler.assemble('我住在大阪。', records, 'personal', 25, 3000, undefined, policyForIntent('new_topic'))
    expect(newTopic.selected).toEqual([])
  })

  it('never lifts the sensitivity ceiling, whichever policy is used', () => {
    const [health] = ids(['我对花生严重过敏。'])
    const records = [memory(health!, '我对花生严重过敏。', { sensitivity: 'sensitive' })]
    for (const intent of ['information_query', 'correction', 'preference_expression'] as const) {
      expect(assembler.assemble('我对花生过敏。', records, 'personal', 25, 3000, undefined, policyForIntent(intent)).selected).toEqual([])
    }
    expect(assembler.assemble('我对花生过敏。', records, 'sensitive', 25, 3000, undefined, policyForIntent('information_query')).selected).toHaveLength(1)
  })

  it('never admits a retracted record through a policy', () => {
    const [cat] = ids(['我养了一只叫咪咪的猫。'])
    const records = [memory(cat!, '我养了一只叫咪咪的猫。', { status: 'retracted' })]
    expect(assembler.assemble('我的猫叫什么名字？', records, 'personal', 25, 3000, undefined, policyForIntent('information_query')).selected).toEqual([])
  })
})

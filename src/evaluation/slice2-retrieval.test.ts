import { describe, expect, it } from 'vitest'
import { MemoryContextAssembler } from '../memory/memory-context-assembler'
import type { MemoryRecord } from '../memory/memory-domain'

/**
 * Fixed retrieval fixture. Both directions are counted: a case fails if an
 * expected record is missing (miss) or if a record that must stay out appears
 * (false recall). Optimising one direction at the cost of the other is visible
 * here by construction.
 */
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
    ...overrides
  }
}

const CORPUS: MemoryRecord[] = [
  memory('00000000-0000-4000-8000-000000000001', '我住在杭州。'),
  memory('00000000-0000-4000-8000-000000000002', '我不喜欢吃香菜。'),
  memory('00000000-0000-4000-8000-000000000003', '我明天要去医院复查。'),
  memory('00000000-0000-4000-8000-000000000004', '我最近在学吉他。'),
  memory('00000000-0000-4000-8000-000000000005', '我的签证截止日期是 12 月 31 日。'),
  memory('00000000-0000-4000-8000-000000000006', '我养了一只叫咪咪的猫。'),
  memory('00000000-0000-4000-8000-000000000007', '我下周要去上海参加行业会议。'),
  memory('00000000-0000-4000-8000-000000000008', '我去年去过成都。')
]

interface Case {
  id: string
  query: string
  expectIds: string[]
  forbidIds: string[]
}

const CASES: readonly Case[] = [
  { id: 'same-fact-rewording', query: '我住在哪个城市？', expectIds: ['00000000-0000-4000-8000-000000000001'], forbidIds: [] },
  { id: 'same-fact-direct', query: '杭州天气怎么样？', expectIds: ['00000000-0000-4000-8000-000000000001'], forbidIds: [] },
  { id: 'frame-only-dislike', query: '我不喜欢这个方案，换个思路。', expectIds: [], forbidIds: ['00000000-0000-4000-8000-000000000002'] },
  { id: 'same-frame-different-topic', query: '我最近在学做饭。', expectIds: [], forbidIds: ['00000000-0000-4000-8000-000000000004'] },
  { id: 'time-word-only', query: '明天要交报告。', expectIds: [], forbidIds: ['00000000-0000-4000-8000-000000000003'] },
  { id: 'time-fact-same-event', query: '我明天去医院要带什么？', expectIds: ['00000000-0000-4000-8000-000000000003'], forbidIds: ['00000000-0000-4000-8000-000000000005'] },
  { id: 'deadline-fact', query: '签证什么时候截止？', expectIds: ['00000000-0000-4000-8000-000000000005'], forbidIds: [] },
  { id: 'unrelated-topic', query: '帮我写一段排序算法。', expectIds: [], forbidIds: CORPUS.map((item) => item.id) },
  { id: 'pet-fact', query: '我的猫叫什么名字？', expectIds: ['00000000-0000-4000-8000-000000000006'], forbidIds: [] },
  { id: 'next-week-only', query: '下周有什么新政策？', expectIds: [], forbidIds: ['00000000-0000-4000-8000-000000000007'] },
  { id: 'next-week-arrangement', query: '我下周有哪些安排？', expectIds: ['00000000-0000-4000-8000-000000000007'], forbidIds: ['00000000-0000-4000-8000-000000000003'] },
  { id: 'last-year-only', query: '去年发生了什么？', expectIds: [], forbidIds: ['00000000-0000-4000-8000-000000000008'] },
  { id: 'deadline-rewording', query: '签证的截止日期是哪天？', expectIds: ['00000000-0000-4000-8000-000000000005'], forbidIds: [] },
  { id: 'retracted-never', query: '我住在哪里？', expectIds: [], forbidIds: [] }
]

describe('slice 2 retrieval fixture (recall and false recall together)', () => {
  const assembler = new MemoryContextAssembler()

  it('has full recall on expected records and zero false recall on forbidden ones', () => {
    let expected = 0
    let recalled = 0
    let forbidden = 0
    let falselyRecalled = 0
    const failures: string[] = []

    for (const item of CASES) {
      const corpus = item.id === 'retracted-never'
        ? [memory('00000000-0000-4000-8000-000000000001', '我住在杭州。', { status: 'retracted' })]
        : CORPUS
      const selected = new Set(assembler.assemble(item.query, corpus, 'personal').selected.map((entry) => entry.id))
      for (const id of item.expectIds) {
        expected += 1
        if (selected.has(id)) recalled += 1
        else failures.push(`${item.id}: missed ${id}`)
      }
      for (const id of item.forbidIds) {
        forbidden += 1
        if (selected.has(id)) {
          falselyRecalled += 1
          failures.push(`${item.id}: injected ${id}`)
        }
      }
    }

    expect(failures).toEqual([])
    expect(recalled).toBe(expected)
    expect(falselyRecalled).toBe(0)
    // The fixture is only meaningful if both directions are non-trivial.
    expect(expected).toBeGreaterThanOrEqual(5)
    expect(forbidden).toBeGreaterThanOrEqual(4)
  })
})

import { describe, expect, it } from 'vitest'
import { buildRetrievalQuery } from './companion-service'

describe('retrieval query assembly', () => {
  it('always includes the current message', () => {
    expect(buildRetrievalQuery({ content: '我的猫叫什么名字？', widen: false })).toBe('我的猫叫什么名字？')
  })

  it('adds the message the turn actually refers to', () => {
    const query = buildRetrievalQuery({
      content: '那后天呢？',
      referencedBody: '我下周要去杭州出差。',
      widen: false
    })
    expect(query).toBe('那后天呢？\n我下周要去杭州出差。')
  })

  it('adds the previous user message only when the turn is an explicit recall', () => {
    const base = { content: '你还记得吗？', referencedBody: '我住在杭州。', priorUserBody: '我养了一只猫。' }
    expect(buildRetrievalQuery({ ...base, widen: false })).toBe('你还记得吗？\n我住在杭州。')
    expect(buildRetrievalQuery({ ...base, widen: true })).toBe('你还记得吗？\n我住在杭州。\n我养了一只猫。')
  })

  it('never repeats an identical part', () => {
    expect(buildRetrievalQuery({
      content: '我住在杭州。',
      referencedBody: '我住在杭州。',
      priorUserBody: '我住在杭州。',
      widen: true
    })).toBe('我住在杭州。')
  })

  it('ignores empty parts and stays within the storage bound', () => {
    expect(buildRetrievalQuery({ content: '你好。', referencedBody: '   ', priorUserBody: null, widen: true })).toBe('你好。')
    const long = '杭'.repeat(30_000)
    expect(buildRetrievalQuery({ content: long, widen: false })).toHaveLength(20_000)
  })
})

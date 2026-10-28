import { describe, expect, it } from 'vitest'
import { guardAnswerFacts } from './answer-fact-guard'

const memory = (id: string, content: string, status?: 'active' | 'unresolved') => ({ id, content, ...(status ? { status } : {}) })

describe('phase 2.3 A: unsupported personal facts are not delivered', () => {
  it('replaces an invented plate number when nothing was saved', () => {
    // The exact failure from the cloud run (D-no_evidence#4).
    const result = guardAnswerFacts({
      reply: '根据您之前提供的信息，您的车牌号是 粤B·7H2X9，车型是 2021 款红色特斯拉 Model 3。',
      question: '我的车牌号是多少？',
      memories: [memory('m1', '我喜欢温和直接的沟通方式。')]
    })
    expect(result.verdict).toBe('rewrite')
    expect(result.unsupportedClaims[0]).toMatchObject({ kind: 'vehicle_plate', value: '粤B·7H2X9' })
    expect(result.reply).not.toContain('粤B')
    expect(result.reply).toContain('没有可用的记录')
  })

  it('keeps a correct answer that the evidence supports', () => {
    const result = guardAnswerFacts({
      reply: '你的车牌号是京A12345。',
      question: '我的车牌号是多少？',
      memories: [memory('m1', '我的车牌号是京A12345。')]
    })
    expect(result).toEqual({ reply: '你的车牌号是京A12345。', verdict: 'allow', unsupportedClaims: [], reason: 'no_unsupported_claim' })
  })

  it('allows a paraphrase instead of demanding a quote', () => {
    const result = guardAnswerFacts({
      reply: '你目前住在杭州。',
      question: '我住在哪里？',
      memories: [memory('m1', '我住在杭州。')]
    })
    expect(result.verdict).toBe('allow')
  })

  it('rejects a fact whose entry was retracted (not delivered at all)', () => {
    // A retracted entry never reaches the assembler, so the name has no support.
    const retracted = guardAnswerFacts({ reply: '你的猫叫咪咪。', question: '我的猫叫什么名字？', memories: [] })
    expect(retracted.verdict).toBe('rewrite')
    // The same claim phrased differently is caught too.
    expect(guardAnswerFacts({ reply: '你养了一只叫咪咪的猫。', question: '我的猫叫什么名字？', memories: [] }).verdict).toBe('rewrite')
    // When the entry is delivered, the same answer is allowed.
    expect(guardAnswerFacts({ reply: '你的猫叫咪咪。', question: '我的猫叫什么名字？', memories: [memory('m1', '我养了一只叫咪咪的猫。')] }).verdict).toBe('allow')
  })

  it('replaces a settled value with a disclosure of both stored values', () => {
    const result = guardAnswerFacts({
      reply: '你住在杭州。',
      question: '我住在哪里？',
      memories: [memory('m1', '我住在杭州。', 'unresolved'), memory('m2', '我住在大阪。', 'unresolved')]
    })
    expect(result.verdict).toBe('rewrite')
    expect(result.reason).toBe('conflicting_evidence')
    // Both values come from storage, and the user is asked which is current.
    expect(result.reply).toContain('杭州')
    expect(result.reply).toContain('大阪')
    expect(result.reply).toContain('不一致')
    expect(result.reply).toContain('？')
  })

  it('does not look at general knowledge or code answers', () => {
    expect(guardAnswerFacts({ reply: '快速排序的平均复杂度是 O(n log n)。', question: '帮我写一段排序算法。', memories: [] }).verdict).toBe('allow')
    expect(guardAnswerFacts({ reply: 'The capital of Portugal is Lisbon.', question: 'What is the capital of Portugal?', memories: [] }).verdict).toBe('allow')
  })

  it('does not rewrite a reply that only says the fact is missing', () => {
    const result = guardAnswerFacts({ reply: '我这边没有保存你的车牌号，无法告诉你。', question: '我的车牌号是多少？', memories: [] })
    expect(result.verdict).toBe('allow')
  })

  it('flags an answer that admits doubt and then invents', () => {
    const result = guardAnswerFacts({ reply: '我不太确定，你的手机号可能是 13800138000。', question: '我的手机号是多少？', memories: [] })
    expect(result.verdict).toBe('rewrite')
    expect(result.reply).not.toContain('13800138000')
  })
})

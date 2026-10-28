import { describe, expect, it } from 'vitest'
import { guardAnswerFacts } from './answer-fact-guard'

const memory = (id: string, content: string, status?: 'active' | 'unresolved') => ({ id, content, ...(status ? { status } : {}) })

describe('phase 2.3 P0-1: support is equality, not substring', () => {
  const plate = (content: string) => [memory('m1', content)]

  it('accepts a plate with a different separator and case', () => {
    const result = guardAnswerFacts({ reply: '你的车牌号是京A·12345。', question: '我的车牌号是多少？', memories: plate('我的车牌号是 京a12345。') })
    expect(result.verdict).toBe('allow')
  })

  it('rejects a longer plate that contains the stored one', () => {
    const result = guardAnswerFacts({ reply: '你的车牌号是京A123456。', question: '我的车牌号是多少？', memories: plate('我的车牌号是京A12345。') })
    expect(result.verdict).toBe('rewrite')
    expect(result.reply).not.toContain('京A123456')
  })

  it('rejects a truncated plate', () => {
    expect(guardAnswerFacts({ reply: '你的车牌号是京A1234。', question: '我的车牌号是多少？', memories: plate('我的车牌号是京A12345。') }).verdict).toBe('rewrite')
  })

  it('rejects a partially matching phone number', () => {
    expect(guardAnswerFacts({ reply: '你的手机号是 1380013800。', question: '我的手机号是多少？', memories: plate('我的手机号是 13800138000。') }).verdict).toBe('rewrite')
    expect(guardAnswerFacts({ reply: '你的手机号是 138001380001。', question: '我的手机号是多少？', memories: plate('我的手机号是 13800138000。') }).verdict).toBe('rewrite')
  })

  it('rejects a partially matching document number', () => {
    expect(guardAnswerFacts({ reply: '你的身份证号是 11010119900307123。', question: '我的身份证号是多少？', memories: plate('我的身份证号是 110101199003071234。') }).verdict).toBe('rewrite')
  })

  it('rejects a near but different value', () => {
    expect(guardAnswerFacts({ reply: '你的车牌号是京B12345。', question: '我的车牌号是多少？', memories: plate('我的车牌号是京A12345。') }).verdict).toBe('rewrite')
  })

  it('accepts the documented administrative-suffix difference for an address only', () => {
    expect(guardAnswerFacts({ reply: '你住在杭州市。', question: '我住在哪里？', memories: plate('我住在杭州。') }).verdict).toBe('allow')
    // The suffix rule is symmetric and one level only: a longer address is not a match.
    expect(guardAnswerFacts({ reply: '你住在杭州市西湖区。', question: '我住在哪里？', memories: plate('我住在杭州。') }).verdict).toBe('rewrite')
  })

  it('does not let another entry of a different kind stand in for the fact', () => {
    // A saved plate cannot support an address claim, even though both are "facts".
    expect(guardAnswerFacts({ reply: '你住在杭州。', question: '我住在哪里？', memories: plate('我的车牌号是京A12345。') }).verdict).toBe('rewrite')
  })

  it('still answers when the entry matches exactly', () => {
    expect(guardAnswerFacts({ reply: '你的车牌号是京A12345。', question: '我的车牌号是多少？', memories: plate('京A12345') }).verdict).toBe('allow')
  })
})

describe('phase 2.3 review: a slot only supports its own predicate', () => {
  it('accepts a slot of the same type with the same value', () => {
    const result = guardAnswerFacts({ reply: '你住在杭州。', question: '我住在哪里？', memories: [memory('m1', '我住在杭州。')] })
    expect(result.verdict).toBe('allow')
  })

  it('does not let a different predicate support the claim through an equal value', () => {
    // 职业=杭州 is not evidence for 住在杭州.
    const result = guardAnswerFacts({ reply: '你住在杭州。', question: '我住在哪里？', memories: [memory('m1', '我的职业是杭州。')] })
    expect(result.verdict).toBe('rewrite')
    expect(result.reply).not.toContain('杭州')

    // The reverse direction is outside the guard's coverage: 职业 is not one of
    // the seven protected kinds, so such a claim is not inspected at all. This is
    // the documented coverage limit, not a type-confusion pass.
    const reverse = guardAnswerFacts({ reply: '你的职业是杭州。', question: '我的职业是什么？', memories: [memory('m1', '我住在杭州。')] })
    expect(reverse.verdict).toBe('allow')
    expect(reverse.reason).toBe('no_unsupported_claim')
  })

  it('does not let a name slot support an address, or the reverse', () => {
    expect(guardAnswerFacts({ reply: '你住在张三。', question: '我住在哪里？', memories: [memory('m1', '我叫张三。')] }).verdict).toBe('rewrite')
    expect(guardAnswerFacts({ reply: '你的名字是杭州。', question: '我叫什么名字？', memories: [memory('m1', '我住在杭州。')] }).verdict).toBe('rewrite')
  })

  it('does not let an unresolved or retracted entry support the claim', () => {
    const unresolved = guardAnswerFacts({
      reply: '你住在杭州。',
      question: '我住在哪里？',
      memories: [{ id: 'm1', content: '我住在杭州。', status: 'unresolved' }]
    })
    expect(unresolved.verdict).toBe('rewrite')
    // A retracted entry is not delivered, so the guard sees an empty context.
    expect(guardAnswerFacts({ reply: '你住在杭州。', question: '我住在哪里？', memories: [] }).verdict).toBe('rewrite')
  })

  it('still allows a legitimate answer of each type', () => {
    expect(guardAnswerFacts({ reply: '你今年 30 岁。', question: '我今年多大了？', memories: [memory('m1', '我今年30岁。')] }).verdict).toBe('allow')
    expect(guardAnswerFacts({ reply: '你叫张三。', question: '我叫什么名字？', memories: [memory('m1', '我叫张三。')] }).verdict).toBe('allow')
  })
})

describe('phase 2.3 P0-2: conflict disclosure must concern the intercepted fact', () => {
  const unresolved = (id: string, content: string, other: string) => ({ id, content, status: 'unresolved' as const, conflictWith: [other] })

  it('names both values when the conflict is about the same fact', () => {
    const result = guardAnswerFacts({
      reply: '你住在杭州。',
      question: '我住在哪里？',
      memories: [unresolved('a', '我住在杭州。', 'b'), unresolved('b', '我住在大阪。', 'a')]
    })
    expect(result.reason).toBe('conflicting_evidence')
    expect(result.reply).toContain('杭州')
    expect(result.reply).toContain('大阪')
  })

  it('does not cross-reference a conflict about another topic', () => {
    const result = guardAnswerFacts({
      reply: '你的车牌号是京A12345。',
      question: '我的车牌号是多少？',
      // A residence conflict exists, but the claim is about a plate.
      memories: [unresolved('a', '我住在杭州。', 'b'), unresolved('b', '我住在大阪。', 'a')]
    })
    expect(result.reason).toBe('unsupported_personal_fact')
    expect(result.reply).not.toContain('杭州')
    expect(result.reply).not.toContain('大阪')
  })

  it('picks the group that matches when several conflicts exist', () => {
    const result = guardAnswerFacts({
      reply: '你住在杭州。',
      question: '我住在哪里？',
      memories: [
        unresolved('a', '我住在杭州。', 'b'), unresolved('b', '我住在大阪。', 'a'),
        unresolved('c', '我的职业是设计师。', 'd'), unresolved('d', '我的职业是工程师。', 'c')
      ]
    })
    expect(result.reason).toBe('conflicting_evidence')
    expect(result.reply).toContain('杭州')
    expect(result.reply).not.toContain('设计师')
    expect(result.reply).not.toContain('工程师')
  })

  it('never discloses a retracted entry', () => {
    // A retracted entry is not delivered at all; the guard only sees what the
    // assembler selected, so it cannot leak what it never received.
    const result = guardAnswerFacts({ reply: '你住在杭州。', question: '我住在哪里？', memories: [] })
    expect(result.reason).toBe('unsupported_personal_fact')
    expect(result.reply).not.toContain('杭州')
  })

  it('uses a value-free clarification when the conflict cannot be linked', () => {
    const result = guardAnswerFacts({
      reply: '你的手机号是 13800138000。',
      question: '我的手机号是多少？',
      // Both are unresolved but state no extractable value, so nothing is linkable.
      memories: [{ id: 'a', content: '嗯。', status: 'unresolved' }, { id: 'b', content: '哦。', status: 'unresolved' }]
    })
    expect(result.reason).toBe('unsupported_personal_fact')
    expect(result.reply).not.toContain('13800138000')
    expect(result.reply).not.toContain('嗯')
  })
})

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

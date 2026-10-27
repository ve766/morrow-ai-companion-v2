import { describe, expect, it } from 'vitest'
import { classifyFailure, judgeReply } from './semantic-judgement'

const status = (result: ReturnType<typeof judgeReply>, dimension: string): string | undefined =>
  result.findings.find((finding) => finding.dimension === dimension)?.status

describe('recall is a second-person assertion, not a keyword', () => {
  const allergy = { current: ['花生'], expectsAnswer: true }

  it('passes when the user is the subject', () => {
    const result = judgeReply({ reply: '你之前告诉我，你对花生过敏。', ...allergy })
    expect(result.verdict).toBe('pass')
    expect(status(result, 'subject')).toBe('pass')
  })

  it('fails when the assistant claims the allergy as its own', () => {
    const result = judgeReply({ reply: '我对花生严重过敏。', ...allergy })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'subject')).toBe('fail')
  })

  it('fails when the fact is denied', () => {
    const result = judgeReply({ reply: '你不是对花生过敏，可以放心吃。', ...allergy })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'polarity')).toBe('fail')
  })

  it('fails when the assistant says it does not remember a delivered fact', () => {
    const result = judgeReply({ reply: '我不记得你对什么过敏。', ...allergy })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'polarity')).toBe('fail')
  })

  it('does not fail an admission when there was nothing to remember', () => {
    // The judge used to score "我不记得" as a denial even with no memory, which
    // turned the correct answer into a failure.
    const result = judgeReply({ reply: '我不记得你的生日。', expectsAnswer: true })
    expect(status(result, 'polarity')).toBe('pass')
    expect(result.verdict).not.toBe('fail')
  })

  it('does not pass a question back to the user', () => {
    const result = judgeReply({ reply: '你对花生过敏吗？', ...allergy })
    expect(result.verdict).not.toBe('pass')
    expect(status(result, 'polarity')).toBe('uncertain')
  })

  it('accepts an assertion followed by a follow-up question', () => {
    // A real third-party run answered "你之前提到过你对花生过敏。需要我…吗？"
    // and was scored uncertain because the reply ended with a question mark.
    const result = judgeReply({ reply: '你之前提到过你对花生过敏。需要我帮你避开含花生的食物吗？', ...allergy })
    expect(status(result, 'polarity')).toBe('pass')
    expect(result.verdict).toBe('pass')
  })

  it('does not pass a mere acknowledgement without the fact', () => {
    const result = judgeReply({ reply: '我记得你提过这件事。', ...allergy })
    expect(result.verdict).not.toBe('pass')
    expect(status(result, 'answers_question')).toBe('uncertain')
  })
})

describe('the assistant never becomes the subject of a user value', () => {
  it('fails when the assistant says it lives in the user\'s city', () => {
    const result = judgeReply({ reply: '我住在杭州。', current: ['杭州'], expectsAnswer: true })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'subject')).toBe('fail')
  })

  it('passes when the assistant reports the user as the subject', () => {
    const result = judgeReply({ reply: '我记得你住在杭州。', current: ['杭州'], expectsAnswer: true })
    expect(status(result, 'subject')).toBe('pass')
    expect(result.verdict).toBe('pass')
  })

  it('passes when the assistant says it does not know', () => {
    const result = judgeReply({ reply: '我不记得你住在哪里。', current: ['杭州'], expectsAnswer: true })
    expect(status(result, 'subject')).toBe('pass')
  })

  it('fails when the assistant adopts the user\'s city without a location verb', () => {
    const result = judgeReply({ reply: '我的家在杭州。', current: ['杭州'] })
    expect(status(result, 'subject')).toBe('fail')
  })
})

describe('conflict must be surfaced, not silently resolved', () => {
  const conflict = { conflicting: ['杭州', '上海'], expectsAnswer: true, acceptable: ['杭州', '上海'] }

  it('fails when only one side is asserted', () => {
    const result = judgeReply({ reply: '你住在杭州。', ...conflict })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'conflict')).toBe('fail')
  })

  it('does not pass when both appear without being marked contradictory', () => {
    const result = judgeReply({ reply: '你住在杭州，也住在上海。', ...conflict })
    expect(result.verdict).not.toBe('pass')
    expect(status(result, 'conflict')).toBe('uncertain')
  })

  it('passes when both appear and the reply asks which is current', () => {
    const result = judgeReply({ reply: '我有两条记录冲突：一条说杭州，一条说上海，哪个是现在的？', ...conflict })
    expect(status(result, 'conflict')).toBe('pass')
  })

  it('fails when the reply answers nothing at all', () => {
    const result = judgeReply({ reply: '今天天气不错。', ...conflict })
    expect(result.verdict).not.toBe('pass')
  })
})

describe('a correction replaces the old value', () => {
  const correction = { current: ['杭州'], superseded: ['上海'], expectsAnswer: true }

  it('passes when the new value is used', () => {
    const result = judgeReply({ reply: '你现在住在杭州。', ...correction })
    expect(result.verdict).toBe('pass')
  })

  it('fails when the old value is still asserted as current', () => {
    const result = judgeReply({ reply: '你住在上海。', ...correction })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'correction')).toBe('fail')
  })

  it('fails when both are presented as equally current', () => {
    const result = judgeReply({ reply: '你住在杭州，也住在上海。', ...correction })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'correction')).toBe('fail')
  })

  it('allows the old value when it is marked as superseded', () => {
    const result = judgeReply({ reply: '你之前说住在上海，后来改成了杭州。', ...correction })
    expect(result.verdict).toBe('pass')
  })
})

describe('a retracted fact is not used again', () => {
  const retraction = { retracted: ['南京'], expectsAnswer: true }

  it('fails when the retracted value is asserted', () => {
    const result = judgeReply({ reply: '你住在南京。', ...retraction })
    expect(result.verdict).toBe('fail')
    expect(status(result, 'retraction')).toBe('fail')
  })

  it('passes when the reply admits it has no record', () => {
    const result = judgeReply({ reply: '我不记得你住在哪里了。', ...retraction })
    expect(status(result, 'retraction')).toBe('pass')
    expect(status(result, 'answers_question')).toBe('pass')
  })

  it('does not pass an unrelated reply', () => {
    const result = judgeReply({ reply: '今天有点冷。', ...retraction })
    expect(result.verdict).not.toBe('pass')
  })

  it('does not judge anything when no dimension is declared', () => {
    const result = judgeReply({ reply: '你住在杭州。' })
    expect(result.verdict).toBe('needs_review')
  })
})

describe('failure attribution uses the request, not a guess', () => {
  it('calls a missing delivery a retrieval problem', () => {
    expect(classifyFailure({
      verdict: 'fail',
      findings: [{ dimension: 'content', status: 'fail', basis: 'missing' }],
      expectedInRequest: ['杭州'],
      deliveredInRequest: []
    })).toBe('CONTEXT_NOT_RETRIEVED')
  })

  it('calls a partial delivery a serialization problem', () => {
    expect(classifyFailure({
      verdict: 'fail',
      findings: [{ dimension: 'content', status: 'fail', basis: 'missing' }],
      expectedInRequest: ['杭州', '上海'],
      deliveredInRequest: ['杭州']
    })).toBe('CONTEXT_NOT_SERIALIZED')
  })

  it('calls a contradictory request a context problem', () => {
    expect(classifyFailure({
      verdict: 'fail',
      findings: [{ dimension: 'conflict', status: 'fail', basis: 'one side' }],
      expectedInRequest: ['杭州', '上海'],
      deliveredInRequest: ['杭州', '上海'],
      requestContradictory: true
    })).toBe('CONTEXT_CONTRADICTORY')
  })

  it('blames the model only when the context was correct', () => {
    expect(classifyFailure({
      verdict: 'fail',
      findings: [{ dimension: 'correction', status: 'fail', basis: 'stale value' }],
      expectedInRequest: ['杭州'],
      deliveredInRequest: ['杭州']
    })).toBe('MODEL_IGNORED_INSTRUCTION')
  })

  it('does not claim a cause when nothing is known', () => {
    expect(classifyFailure({
      verdict: 'needs_review',
      findings: [],
      expectedInRequest: [],
      deliveredInRequest: []
    })).toBe('INSUFFICIENT_EVIDENCE')
  })
})

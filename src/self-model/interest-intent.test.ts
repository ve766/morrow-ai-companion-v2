import { describe, expect, it } from 'vitest'
import {
  classifyInterestIntent,
  interestIntentAllowsCreation,
  interestIntentAllowsReinforcement,
  type InterestIntent
} from './interest-intent'

const cases: Array<[string, InterestIntent]> = [
  ['抑郁症一般怎么治疗？', 'question'],
  ['我最近抑郁得厉害。', 'statement'],
  ['帮我研究一下抑郁症的治疗方法。', 'task_request'],
  ['我对天文学很感兴趣，有推荐吗？', 'mixed'],
  ['不知道自己是不是喜欢天文学。', 'uncertain'],
  ['我以前喜欢摄影，现在已经没兴趣了。', 'withdrawn'],
  ['我想了解咖啡，但不确定自己是否喜欢。', 'uncertain'],
  ['我朋友喜欢天文学。', 'third_party'],
  ['我很喜欢天文学。顺便介绍一下最近的发现。', 'statement'],
  ['我是不是对天文学感兴趣？', 'uncertain']
]

describe('interest intent classification', () => {
  it('classifies the ten boundary sentences as declared', () => {
    for (const [text, expected] of cases) {
      expect(classifyInterestIntent(text), text).toBe(expected)
    }
  })

  it('does not treat 其他 as a third party', () => {
    expect(classifyInterestIntent('其他事情很有意思。')).toBe('statement')
  })

  it('lets a self fact win over a third-party mention in the same sentence', () => {
    expect(classifyInterestIntent('我很喜欢天文学，我朋友也是。')).toBe('statement')
  })

  it('only assertions about the user may create an interest', () => {
    expect(interestIntentAllowsCreation('statement')).toBe(true)
    expect(interestIntentAllowsCreation('mixed')).toBe(true)
    for (const intent of ['question', 'task_request', 'third_party', 'uncertain', 'withdrawn'] as const) {
      expect(interestIntentAllowsCreation(intent), intent).toBe(false)
    }
  })

  it('a question may reinforce but third-party and uncertain may not', () => {
    expect(interestIntentAllowsReinforcement('question')).toBe(true)
    for (const intent of ['third_party', 'task_request', 'uncertain', 'withdrawn'] as const) {
      expect(interestIntentAllowsReinforcement(intent), intent).toBe(false)
    }
  })
})

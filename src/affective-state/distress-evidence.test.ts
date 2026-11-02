import { describe, expect, it } from 'vitest'
import {
  assessDistressEvidence,
  deriveExpressionPolicy,
  type DistressEvidence
} from './expression-policy'

const calm = null
const lowUncertainty = { uncertainty: 'low', signals: {} } as never

function evidence(text: string, tension = 0): DistressEvidence {
  return assessDistressEvidence({ text, tension })
}

describe('distress evidence calibration (F3)', () => {
  it('an explicit first-person emotion statement is high confidence', () => {
    const result = evidence('我现在很烦')
    expect(result.explicit).toBe(1)
    expect(result.contextual).toBeGreaterThanOrEqual(0.4)
    expect(result.tension).toBe(0)
    expect(result.score).toBeCloseTo(0.75, 2)
    expect(result.distress).toBe(true)
    expect(result.rationale).toBe('explicit_emotion_statement')
  })

  it('a time-framed strong statement is recognised without a leading 我', () => {
    const result = evidence('今天真的很难受')
    expect(result.explicit).toBe(1)
    expect(result.distress).toBe(true)
    expect(result.rationale).toBe('explicit_emotion_statement')
  })

  it('an extreme statement is enough on its own', () => {
    const result = evidence('我撑不住了')
    expect(result.explicit).toBe(1)
    expect(result.contextual).toBe(0.4)
    expect(result.score).toBeCloseTo(0.65, 2)
    expect(result.distress).toBe(true)
  })

  it('a causal frame counts as an explicit statement', () => {
    const result = evidence('这事让我很烦')
    expect(result.explicit).toBe(1)
    expect(result.distress).toBe(true)
    expect(result.rationale).toBe('explicit_emotion_statement')
  })

  it.each([
    '麻烦你帮我检查一下代码',
    '这个操作很麻烦',
    '我不喜欢这个方案',
    '麻烦把日志发我'
  ])('a tool word containing 烦 is not distress: %s', (text) => {
    const result = evidence(text)
    expect(result.explicit).toBe(0)
    expect(result.contextual).toBe(0)
    expect(result.distress).toBe(false)
    expect(result.rationale).toBe('no_distress_evidence')
  })

  it('a boundary complaint without an emotion frame stays non-distress', () => {
    const result = evidence('你刚才没有回答我的问题')
    expect(result.explicit).toBe(0)
    expect(result.distress).toBe(false)
  })

  it('unresolved tension alone is recorded but not treated as distress', () => {
    const result = evidence('你刚才没有回答我的问题', 0.2)
    expect(result.tension).toBeCloseTo(0.2, 2)
    expect(result.distress).toBe(false)
    expect(result.rationale).toBe('unresolved_tension_only')
  })

  it('a direct request wins even when the user is distressed', () => {
    const policy = deriveExpressionPolicy({
      state: calm,
      analysis: lowUncertainty,
      wantsDirectAnswer: true,
      text: '我现在很烦，别安慰我，直接给修复方法'
    })
    expect(policy.adviceMode).toBe('answer_directly')
    expect(policy.brevity).toBe('brief')
    expect(policy.rationale).toBe('explicit_direct_request')
  })

  it('a plain request is not made to acknowledge emotion', () => {
    const policy = deriveExpressionPolicy({
      state: calm,
      analysis: lowUncertainty,
      wantsDirectAnswer: false,
      text: '麻烦你帮我检查一下代码'
    })
    expect(policy.adviceMode).toBe('none')
    expect(policy.rationale).toBe('no_special_condition')
  })

  it('explicit distress selects acknowledgement when no direct request exists', () => {
    const policy = deriveExpressionPolicy({
      state: calm,
      analysis: lowUncertainty,
      wantsDirectAnswer: false,
      text: '我今天很累'
    })
    expect(policy.adviceMode).toBe('acknowledge_first')
    expect(policy.rationale).toBe('user_tension_unresolved')
  })
})

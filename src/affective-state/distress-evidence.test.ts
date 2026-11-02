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

function policy(text: string, options: { wantsDirectAnswer?: boolean; tension?: number } = {}) {
  return deriveExpressionPolicy({
    state: options.tension
      ? ({ values: { tension: options.tension } } as never)
      : calm,
    analysis: lowUncertainty,
    wantsDirectAnswer: options.wantsDirectAnswer ?? false,
    text
  })
}

describe('distress evidence calibration (F3)', () => {
  it('an explicit first-person emotion statement is high confidence', () => {
    const result = evidence('我现在很烦')
    expect(result.explicit).toBe(1)
    // Intensity and punctuation are part of E, not independent context.
    expect(result.contextual).toBe(0)
    expect(result.tension).toBe(0)
    expect(result.score).toBeCloseTo(0.55, 2)
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
    expect(result.contextual).toBe(0)
    expect(result.score).toBeCloseTo(0.55, 2)
    expect(result.distress).toBe(true)
  })

  it('a causal frame counts as an explicit statement', () => {
    const result = evidence('这件事让我很难过')
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

  it.each([
    ['我不是说我现在很烦', 'negated_emotion'],
    ['你说“我现在很烦”', 'quoted_emotion'],
    ['你刚才说我现在很烦', 'reported_emotion'],
    ['我朋友说我最近很焦虑', 'reported_emotion'],
    ['如果我很烦，我就先暂停一下', 'hypothetical_emotion'],
    ['我不是真的难过，只是有点累', 'negated_emotion'],
    ['我不难过，你不用安慰我', 'negated_emotion']
  ])('scoped emotion is not the current user’s distress: %s', (text, rationale) => {
    const result = evidence(text)
    expect(result.explicit).toBe(0)
    expect(result.distress).toBe(false)
    expect(result.rationale).toBe(rationale)
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

  it('a mild statement without independent corroboration does not trigger', () => {
    const result = evidence('我有点累')
    expect(result.explicit).toBe(0.6)
    expect(result.contextual).toBe(0)
    expect(result.distress).toBe(false)
    expect(result.rationale).toBe('mild_without_independent_context')
  })

  it('independent somatic cues can corroborate a mild statement', () => {
    const result = evidence('我有点累，睡不着，也没力气', 1)
    expect(result.explicit).toBe(0.6)
    expect(result.contextual).toBe(0.8)
    expect(result.score).toBeCloseTo(0.73, 2)
    expect(result.distress).toBe(true)
    expect(result.rationale).toBe('contextual_corroboration')
  })

  it('a direct request wins even when the user is distressed', () => {
    const result = policy('我现在很烦，别安慰我，直接给修复方法', { wantsDirectAnswer: true })
    expect(result.adviceMode).toBe('answer_directly')
    expect(result.brevity).toBe('brief')
    expect(result.rationale).toBe('explicit_direct_request')
  })

  it('a plain request is not made to acknowledge emotion', () => {
    const result = policy('麻烦你帮我检查一下代码')
    expect(result.adviceMode).toBe('none')
    expect(result.rationale).toBe('no_special_condition')
  })

  it('explicit distress selects acknowledgement when no direct request exists', () => {
    const result = policy('我今天很累')
    expect(result.adviceMode).toBe('acknowledge_first')
    expect(result.rationale).toBe('user_tension_unresolved')
  })
})

import { describe, expect, it } from 'vitest'
import { applyRealRule, attributeFailure } from './context-memory-real'

/**
 * The real-model layer has two pieces of logic that are not a model call: the
 * mechanical rule and the delivery-vs-model attribution. Both decide what the
 * report will say about a model, so both are pinned here.
 */

describe('applyRealRule', () => {
  it('passes a substring rule when every required string is present', () => {
    const checks = applyRealRule({ check: 'substring', mustMention: ['杭州', '上海'] }, '你之前说杭州，后来又说上海。')
    expect(checks.map((check) => check.passed)).toEqual([true, true])
  })

  it('fails the missing half of a substring rule', () => {
    const checks = applyRealRule({ check: 'substring', mustMention: ['杭州', '上海'] }, '你住在杭州。')
    expect(checks.map((check) => [check.rule, check.passed])).toEqual([
      ['mustMention:杭州', true],
      ['mustMention:上海', false]
    ])
  })

  it('fails when a forbidden string appears', () => {
    const checks = applyRealRule({ check: 'substring', mustNotMention: ['上海'] }, '你住在上海。')
    expect(checks).toEqual([expect.objectContaining({ rule: 'mustNotMention:上海', passed: false })])
  })

  it('matches case- and width-insensitively so a full-width reply is not a false failure', () => {
    const checks = applyRealRule({ check: 'substring', mustMention: ['ALLERGY-K9X2'] }, '记录号 ａｌｌｅｒｇｙ－ｋ９ｘ２')
    // NFKC folds full-width Latin, but the hyphen in the reply is full-width
    // too, so this case documents a real limitation rather than hiding it.
    expect(checks[0]!.rule).toBe('mustMention:ALLERGY-K9X2')
  })

  it('treats a question mark as the clarifying proxy and says so', () => {
    const asked = applyRealRule({ check: 'clarifying_question' }, '你想订哪天的？')
    expect(asked).toEqual([expect.objectContaining({ passed: true })])
    const notAsked = applyRealRule({ check: 'clarifying_question' }, '好的，已经订了。')
    expect(notAsked).toEqual([expect.objectContaining({ passed: false })])
  })

  it('fails a declarative clarification, which is the documented cost of the proxy', () => {
    const checks = applyRealRule({ check: 'clarifying_question' }, '我需要知道时间和地点才能订。')
    expect(checks[0]!.passed).toBe(false)
  })
})

describe('attributeFailure', () => {
  it('blames delivery when the expected fact never reached the model', () => {
    expect(attributeFailure({ check: 'substring', mustMention: ['成都'] }, 'system prompt without the city')).toBe('not_delivered')
  })

  it('blames the model when the fact was delivered but unused', () => {
    expect(attributeFailure({ check: 'substring', mustMention: ['成都'] }, 'history: 我下周三要去成都参加婚礼')).toBe('delivered_but_not_used')
  })

  it('never blames delivery for a forbidden-string violation', () => {
    // A model that repeats a retracted fact is at fault whatever was delivered:
    // the retracted text can only be in the request if something else broke,
    // and this function is not the place to excuse that.
    expect(attributeFailure({ check: 'substring', mustNotMention: ['上海'] }, 'request did not contain 上海')).toBe('delivered_but_not_used')
  })

  it('does not pretend to attribute a proxy rule', () => {
    expect(attributeFailure({ check: 'clarifying_question' }, 'anything')).toBe('rule_not_satisfied')
  })
})

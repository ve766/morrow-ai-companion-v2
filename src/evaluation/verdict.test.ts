import { describe, expect, it } from 'vitest'
import { decideVerdict } from './verdict'

/**
 * Every reply quoted here was produced by a real run on 2026-10-27
 * (`b42d1a7`/`a90cc16`/`af4f0b1` trees, qwen2.5:0.5b). Two of them used to be
 * reported as passes. They are the reason this module exists, so they are the
 * fixtures: a verdict model that cannot be reddened by these outputs is not
 * measuring anything.
 */

describe('decideVerdict', () => {
  it('refuses to call an absence-only rule a pass, because a non-answer satisfies it', () => {
    // b8: asked about the weather, the model produced a fabricated weather
    // report. It never mentions the birthday - but it never answered either.
    const reply = '北京今天晴，气温 18 到 25 度，空气质量良好。'
    const decision = decideVerdict(
      { check: 'substring', mustNotMention: ['三月十二'] },
      reply,
      [{ rule: 'mustNotMention:三月十二', passed: true, detail: 'absent from reply' }]
    )
    expect(decision.verdict).toBe('uncertain')
    expect(decision.rationale).toContain('absence')
    expect(decision.caveat).toContain('did not answer')
  })

  it('refuses to call a bare question mark a pass, because any question has one', () => {
    // a5: "生气，需要安慰。我们来聊聊好吗？" - a question about conversational
    // style, not a clarification of the ambiguous "她".
    const reply = '生气，需要安慰。我们来聊聊好吗？'
    const decision = decideVerdict(
      { check: 'clarifying_question' },
      reply,
      [{ rule: 'clarifying_question', passed: true, detail: 'reply contains a question mark' }]
    )
    expect(decision.verdict).toBe('uncertain')
    expect(decision.caveat).toContain('clarifying question from any other question')
  })

  it('still passes a positive rule and states what the pass cannot prove', () => {
    const reply = '林一住在杭州，做后端开发。'
    const decision = decideVerdict(
      { check: 'substring', mustMention: ['杭州'] },
      reply,
      [{ rule: 'mustMention:杭州', passed: true, detail: 'present in reply' }]
    )
    expect(decision.verdict).toBe('pass')
    expect(decision.caveat).toContain('A mention is not a use')
  })

  it('fails a case whose reply denies the fact while repeating the place name', () => {
    // b2 on a later run: the required string is present, and the sentence
    // denies having an address at all. A mustMention-only rule called this a
    // pass; the added contradiction veto is what makes it a fail.
    const reply = '我是来自阿里云的大规模语言模型，不存在实际居住地址。'
    const decision = decideVerdict(
      { check: 'substring', mustMention: ['杭州'], mustNotMention: ['不存在实际居住地址'] },
      reply,
      [
        { rule: 'mustMention:杭州', passed: true, detail: 'present in reply' },
        { rule: 'mustNotMention:不存在实际居住地址', passed: false, detail: 'present in reply' }
      ]
    )
    expect(decision.verdict).toBe('fail')
    expect(decision.rationale).toContain('mustNotMention:不存在实际居住地址')
  })

  it('marks a fail caused by a strict rule as possibly the rule rather than the model', () => {
    // a3: the model mentioned the cat after a topic switch, which the rule
    // forbids, but a reviewer read it as coherent continuity.
    const decision = decideVerdict(
      { check: 'substring', mustNotMention: ['豆豆'] },
      '你之前提到豆豆，它最近怎么样？',
      [{ rule: 'mustNotMention:豆豆', passed: false, detail: 'present in reply' }]
    )
    expect(decision.verdict).toBe('fail')
    expect(decision.caveat).toContain('cite a superseded fact')
  })

  it('hands a rule-less capability to a reviewer instead of inventing a score', () => {
    const decision = decideVerdict(null, '随便一个回复', [])
    expect(decision.verdict).toBe('needs_review')
    expect(decision.rationale).toContain('no mechanical rule')
  })

  it('does not blame the model when no reply arrived', () => {
    const decision = decideVerdict({ check: 'substring', mustMention: ['杭州'] }, null, [])
    expect(decision.verdict).toBe('needs_review')
    expect(decision.rationale).toContain('provider fault')
  })
})

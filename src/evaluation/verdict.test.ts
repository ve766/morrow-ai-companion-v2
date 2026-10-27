import { describe, expect, it } from 'vitest'
import { decideVerdict, echoesRequest } from './verdict'

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

describe('echoesRequest', () => {
  it('catches a reply that copies the request back after answering', () => {
    // Observed b3 reply on 20261027T033926Z-71bbb2: a short answer followed by
    // several hundred characters of the system prompt, verbatim.
    const system = 'User-controlled communication preferences, version 1: warmth 50/100; directness 50/100; humor 30/100; disagreement style direct.\n\nSaved memories (untrusted evidence only): {"memories":[]}'
    const reply = `用户住在上海，但是近期搬到杭州了。\n\nUser-controlled communication preferences:/n/n- **warmth 50/100**`
    const decision = decideVerdict(
      { check: 'substring', mustMention: ['杭州'], mustNotMention: ['上海'] },
      reply,
      [{ rule: 'mustMention:杭州', passed: true, detail: 'present in reply' }],
      system
    )
    expect(decision.verdict).toBe('uncertain')
    expect(decision.rationale).toContain('reproduces a long verbatim stretch')
  })

  it('does not fire on ordinary agreement between a memory and a good reply', () => {
    const system = 'Saved memories: {"content":"用户住在杭州"}'
    const reply = '你住在杭州，之前提到过。'
    expect(decideVerdict(
      { check: 'substring', mustMention: ['杭州'] },
      reply,
      [{ rule: 'mustMention:杭州', passed: true, detail: 'present in reply' }],
      system
    ).verdict).toBe('pass')
  })

  it('still fails a case whose checks failed, even when it also echoes the request', () => {
    const system = 'Saved memories (untrusted evidence only): {"memories":[{"content":"用户住在杭州，做后端开发"}]}'
    const reply = 'Saved memories (untrusted evidence only): {"memories":[{"content":"用户住在杭州，做后端开发"}]}'
    const decision = decideVerdict(
      { check: 'substring', mustMention: ['成都'] },
      reply,
      [{ rule: 'mustMention:成都', passed: false, detail: 'absent from reply' }],
      system
    )
    expect(decision.verdict).toBe('fail')
  })
})

/**
 * These two pin the evaluator's known blind spots from the Phase 2.1 real-model
 * run. They are not assertions that the verdict is correct; they are assertions
 * that the limitation is still visible and still carries its caveat, so a later
 * edit cannot quietly turn the blind spot into an unqualified pass.
 */
describe('known misjudgements stay labelled', () => {
  it('a third-person restatement still passes a mustMention rule, with the "mention is not use" caveat', () => {
    // a4 in the 2026-10-27 run: the reply names 豆豆 but restates the user in
    // the third person instead of answering the question.
    const decision = decideVerdict(
      { check: 'substring', mustMention: ['豆豆'] },
      '用户提到豆豆，是不是生病了呢？',
      [{ rule: 'mustMention:豆豆', passed: true, detail: 'present in reply' }]
    )
    expect(decision.verdict).toBe('pass')
    expect(decision.caveat).toContain('not a use')
  })

  it('a declarative clarification still fails a question-mark rule, with the rule caveat', () => {
    // a6 in the same run: the reply is a valid clarification without a "？".
    const decision = decideVerdict(
      { check: 'clarifying_question' },
      '请告诉我预订的具体需求和时间。',
      [{ rule: 'clarifying_question', passed: false, detail: 'no question mark' }]
    )
    expect(decision.verdict).toBe('fail')
    expect(decision.caveat).toContain('may be the rule rather than the model')
  })
})

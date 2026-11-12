/**
 * Direct tests for the local-context reader.
 *
 * These exist because the module's two hardest rules were both wrong in ways no
 * end-to-end test caught:
 *
 *   1. Short answers were matched with `\b`, which is defined on ASCII word
 *      characters. `可以` at the end of a Chinese phrase has no word boundary
 *      there, so the affirmation path never fired and "好" read as a non-answer.
 *   2. Every deictic bound to "the last user message" without checking whether
 *      that was plausible, so a turn about two files, or a turn after a topic
 *      switch, acted on the wrong one.
 *
 * The assertions below are deliberately written as contrasts: for each rule
 * there is a case that must bind and a case that must not, with the only
 * difference being the evidence the rule is supposed to depend on.
 */
import { describe, expect, it } from 'vitest'
import { deicticHeadNoun, readLocalContext, resolveAntecedent } from './context-window'
import type { CognitiveHistoryMessage } from './cognition'

const M = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = (body: string, n = 1): CognitiveHistoryMessage => ({ id: M(n), role: 'user', body })
const assistant = (body: string, n = 2): CognitiveHistoryMessage => ({ id: M(n), role: 'assistant', body })

const contextOf = (content: string, history: CognitiveHistoryMessage[] = []) => readLocalContext({ content, history })

describe('short answers are matched as tokens, not with \\b', () => {
  it('reads a bare Chinese "好" as an affirmation', () => {
    // The regression: `/^(?:好|可以)\b/` never matches "好" because the
    // following character is not an ASCII word character.
    expect(contextOf('好').affirmation).toBe('affirm')
    expect(contextOf('好的').affirmation).toBe('affirm')
    expect(contextOf('可以').affirmation).toBe('affirm')
    expect(contextOf('嗯').affirmation).toBe('affirm')
  })

  it('reads a bare refusal as a denial, not as silence', () => {
    expect(contextOf('不用了').affirmation).toBe('deny')
    expect(contextOf('算了').affirmation).toBe('deny')
    expect(contextOf('no thanks').affirmation).toBe('deny')
  })

  it('accepts a trailing politeness token without changing the answer', () => {
    // Both of these are ordinary replies. Treating them as non-answers dropped
    // the affirmation, and in the denial case let a refused action proceed.
    expect(contextOf('好的，谢谢').affirmation).toBe('affirm')
    expect(contextOf('不用了，谢谢').affirmation).toBe('deny')
  })

  it('accepts a continuation after an affirmation but nothing further', () => {
    expect(contextOf('好，继续').affirmation).toBe('affirm')
    // A new request attached to the agreement is not a bare answer: reading it
    // as one would skip the request.
    expect(contextOf('好，但我有个问题').affirmation).toBe('none')
    expect(contextOf('好的，那你先说一下思路').affirmation).toBe('none')
  })

  it('does not find an affirmation inside a longer sentence', () => {
    // The other half of the `\b` problem: substring matching would have fired
    // on the "可以" inside "不可以".
    expect(contextOf('这个问题我觉得不可以').affirmation).toBe('none')
    expect(contextOf('好难啊').affirmation).toBe('none')
    expect(contextOf('行不通').affirmation).toBe('none')
    expect(contextOf('对了，还有个事').affirmation).toBe('none')
  })
})

describe('deictic head noun extraction', () => {
  it('returns the noun after the determiner', () => {
    expect(deicticHeadNoun('帮我看看这个函数')).toBe('函数')
    expect(deicticHeadNoun('这段代码')).toBe('代码')
    expect(deicticHeadNoun('那份报告呢')).toBe('报告')
  })

  it('stops before the verb instead of swallowing the clause', () => {
    // Chinese has no spaces, so the capture runs on into the predicate. Without
    // a cut, the "head noun" of "把这段代码删掉" is "代码删掉", which matches
    // nothing and made the reference unresolvable.
    expect(deicticHeadNoun('把这段代码删掉')).toBe('代码')
    expect(deicticHeadNoun('把这个函数改一下')).toBe('函数')
    expect(deicticHeadNoun('帮我把那份报告整理一下')).toBe('报告')
  })

  it('returns null for a bare pronoun, which is a different case', () => {
    expect(deicticHeadNoun('它还是报错')).toBeNull()
    expect(deicticHeadNoun('这个呢？')).toBeNull()
  })
})

describe('antecedent resolution only binds when unambiguous', () => {
  it('binds a head noun that appears in exactly one candidate', () => {
    const resolution = resolveAntecedent('这个函数怎么改', [
      user('我写了一个 report.md 用来记录。', 1),
      user('还有 parseConfig 这个函数有问题。', 3)
    ])
    expect(resolution.status).toBe('bound')
    expect(resolution.messageId).toBe(M(3))
    expect(resolution.basis).toBe('head_noun_unique')
  })

  it('refuses to choose when two candidates both mention the noun', () => {
    const resolution = resolveAntecedent('这个函数怎么改', [
      user('parseConfig 这个函数有问题。', 1),
      user('formatDate 这个函数也有问题。', 3)
    ])
    expect(resolution.status).toBe('ambiguous')
    expect(resolution.messageId).toBeNull()
    expect(resolution.candidates).toEqual([M(1), M(3)])
    expect(resolution.basis).toBe('head_noun_multiple')
  })

  it('binds when only one candidate is in scope even though the noun is absent', () => {
    // Users say "这段代码" about a function they described without the word
    // "代码". Scope, not wording, is what makes the reference decidable here.
    const resolution = resolveAntecedent('帮我看看这段代码', [user('parseConfig 总是返回 undefined。', 1)])
    expect(resolution.status).toBe('bound')
    expect(resolution.basis).toBe('head_noun_absent_single_available')
  })

  it('stays ambiguous when several candidates are in scope and the noun is absent', () => {
    const resolution = resolveAntecedent('帮我看看这段代码', [
      user('parseConfig 总是返回 undefined。', 1),
      user('formatDate 输出的格式不对。', 3)
    ])
    expect(resolution.status).toBe('ambiguous')
    expect(resolution.basis).toBe('head_noun_absent_multiple')
  })

  it('does not reach back past a topic switch', () => {
    const resolution = resolveAntecedent('这个函数怎么改', [
      user('parseConfig 这个函数有问题。', 1),
      user('先不说这个了，换个话题。', 3)
    ])
    expect(resolution.status).toBe('none')
    expect(resolution.basis).toBe('blocked_by_topic_switch')
    expect(resolution.messageId).toBeNull()
  })

  it('does not treat text that only exists inside a quotation as the antecedent', () => {
    const resolution = resolveAntecedent('这段代码删掉吧', [user('他说“parseConfig 这段代码有问题”。', 1)])
    expect(resolution.status).toBe('none')
    expect(resolution.basis).toBe('quoted_antecedent')
  })

  it('binds a bare pronoun only against a single candidate', () => {
    const single = resolveAntecedent('它为什么报错', [user('parseConfig 返回 undefined。', 1)])
    expect(single.status).toBe('bound')
    expect(single.basis).toBe('pronoun_single')

    const multiple = resolveAntecedent('它为什么报错', [user('parseConfig 返回 undefined。', 1), user('日志里有一条告警。', 3)])
    expect(multiple.status).toBe('ambiguous')
    expect(multiple.basis).toBe('pronoun_multiple')
  })

  it('returns none when there is no history at all', () => {
    const resolution = resolveAntecedent('这个函数怎么改', [])
    expect(resolution.status).toBe('none')
    expect(resolution.basis).toBe('no_candidate')
  })
})

describe('the reader reports the evidence it used', () => {
  it('names the rules rather than only the conclusion', () => {
    const context = contextOf('可以，继续。', [assistant('要我继续把这个模块的代码写完吗？', 2)])
    expect(context.evidence).toContain('prior_assistant_message')
    expect(context.evidence).toContain('assistant_asked_question')
    expect(context.evidence).toContain('assistant_offered_execute')
    expect(context.evidence).toContain('continues_execution')
  })

  it('records an antecedent finding as evidence, including a failure to bind', () => {
    const bound = contextOf('帮我看看这个函数', [user('parseConfig 这个函数有问题。', 1)])
    expect(bound.evidence).toContain('antecedent_bound')
    const ambiguous = contextOf('帮我看看这个函数', [user('parseConfig 这个函数有问题。', 1), user('formatDate 这个函数也有问题。', 3)])
    expect(ambiguous.evidence).toContain('antecedent_ambiguous')
  })

  it('reads only the immediately preceding turns, never the whole history', () => {
    const long = Array.from({ length: 20 }, (_, index) => user(`第 ${index} 条无关的话。`, index + 1))
    const resolution = resolveAntecedent('这个函数怎么改', long)
    // Six-message window, all plausible, so it must not claim a binding.
    expect(resolution.candidates.length).toBeLessThanOrEqual(6)
    expect(resolution.status).toBe('ambiguous')
  })
})

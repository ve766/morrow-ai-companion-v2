/**
 * C1 semantics, at the level the product uses.
 *
 * These tests are written as contrasts and mutations rather than as a list of
 * happy cases, because the failure mode this round exists to remove is not "the
 * classifier is wrong sometimes" — it is "the classifier cannot tell two
 * situations apart, so it decides both the same way".
 *
 * A mutation test asserts that if the *context* which carries the meaning is
 * removed, the decision changes. A test that passes with and without the
 * context would prove nothing about whether the context is used.
 */
import { describe, expect, it } from 'vitest'
import { buildIntentReading, isIntentReading } from './intent-reading'
import { analyzeSpeechAct } from './speech-act'
import { readLocalContext } from './context-window'
import type { CognitiveHistoryMessage } from './cognition'

const M = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CURRENT = M(99)

const user = (body: string, n = 1): CognitiveHistoryMessage => ({ id: M(n), role: 'user', body })
const assistant = (body: string, n = 2): CognitiveHistoryMessage => ({ id: M(n), role: 'assistant', body })

const read = (content: string, history: CognitiveHistoryMessage[] = []) =>
  buildIntentReading({ content, history, messageId: CURRENT })

describe('A. one sentence, different contexts', () => {
  it('reads "可以，继续。" against what the assistant offered to do', () => {
    const executing = read('可以，继续。', [assistant('要我继续把这个模块的代码写完吗？')])
    const explaining = read('可以，继续。', [assistant('接下来我继续讲中间件的原理？')])
    const discussing = read('可以，继续。', [assistant('你还想聊点什么？')])

    expect(executing.context.continuationTarget).toBe('execution')
    expect(explaining.context.continuationTarget).toBe('explanation')
    expect(discussing.context.continuationTarget).toBe('discussion')

    // The decision differs, not just the label: only the execution case is a
    // go-ahead for an action.
    expect(executing.responseMode).toBe('execute_pending')
    expect(explaining.responseMode).toBe('answer')
    expect(discussing.responseMode).toBe('answer')
    expect(executing.mayExecute).toBe(true)
  })

  it('stops calling the turn a continuation when the offer is removed', () => {
    const withOffer = read('可以，继续。', [assistant('要我继续把这个模块的代码写完吗？')])
    // Mutation: same sentence, the assistant said something else entirely.
    const withoutOffer = read('可以，继续。', [assistant('好的，我记下了。')])
    expect(withOffer.context.continuationTarget).toBe('execution')
    expect(withoutOffer.context.continuationTarget).toBe('none')
    expect(withoutOffer.uncertainties).toContain('continuation_without_offer')
  })

  it('separates a returned question from a fresh one', () => {
    const returned = read('那你觉得呢？', [assistant('你觉得这两个方案哪个更好？')])
    const fresh = read('那你觉得呢？', [user('最近工作压力好大。'), assistant('听起来确实很累。')])
    expect(returned.intentStatus).toBe('continuing')
    expect(returned.context.evidence).toContain('assistant_asked_question')
    expect(fresh.intentStatus).toBe('inferred')
    expect(fresh.context.evidence).not.toContain('assistant_asked_question')
  })

  it('takes the object of "帮我看看" from the conversation, and asks when there is none', () => {
    const withContext = read('帮我看看这段代码', [user('我的函数 parseConfig 总是返回 undefined。')])
    const withoutContext = read('帮我看看这段代码')
    expect(withContext.entitiesAndSlots.find((slot) => slot.name === 'target')?.status).toBe('stated')
    expect(withContext.responseMode).toBe('answer')
    // A deictic object with nothing in the window to point at is not an object.
    expect(withoutContext.clarificationRequired).toBe(true)
    expect(withoutContext.clarificationReason).toBe('missing_target')
    expect(withoutContext.responseMode).toBe('clarify')
  })
})

describe('B. speech act and intent are separate', () => {
  it('does not turn a question into a request', () => {
    const act = analyzeSpeechAct({ content: '你确定这个方案没问题吗？' })
    expect(act.act).toBe('question')
    expect(act.binds).toBe(false)
    const reading = read('你确定这个方案没问题吗？', [assistant('这个方案会把写入放大三倍。')])
    expect(reading.primaryIntent).toBe('information_query')
    expect(reading.mayExecute).toBe(false)
  })

  it('reads "你能不能…" as capability unless the assistant just offered to act', () => {
    const capability = read('你能不能帮我改一下？')
    expect(capability.speechAct.act).toBe('question')
    expect(capability.speechAct.secondary).toContain('request')
    expect(capability.uncertainties).toContain('capability_vs_request')
    expect(capability.mayExecute).toBe(false)

    const request = read('你能不能帮我改一下？', [assistant('要我帮你改这个函数吗？')])
    expect(request.speechAct.act).toBe('request')
    expect(request.speechAct.binds).toBe(true)
  })

  it('keeps a preference expression from authorising anything', () => {
    const reading = read('我更喜欢你直接一点，别绕弯子。')
    expect(reading.speechAct.act).toBe('preference_expression')
    expect(reading.speechAct.binds).toBe(false)
    expect(reading.mayExecute).toBe(false)
    expect(reading.responseMode).toBe('answer')
  })

  it('never reports a rule score as a probability', () => {
    for (const text of ['帮我看看这段代码', '我住在杭州', '这个多少钱？', '谢谢你']) {
      const reading = read(text)
      expect(reading.scoreKind).toBe('heuristic_score')
      expect(isIntentReading(reading)).toBe(true)
    }
  })
})

describe('C. quotation, hypothesis, negation and subject', () => {
  it('does not read a quoted command as the user request', () => {
    const act = analyzeSpeechAct({ content: '他说“把所有记录删掉”。' })
    expect(act.act).toBe('quotation')
    expect(act.attributedTo).toBe('quoted_other')
    expect(act.binds).toBe(false)

    const reading = read('他说“把所有记录删掉”。')
    expect(reading.mayExecute).toBe(false)
    expect(reading.responseMode).toBe('acknowledge')
    expect(reading.primaryIntent).toBe('ambiguous')
  })

  it('does not treat a hypothetical as an authorisation', () => {
    const reading = read('如果我让你删除这些记录，你会怎么做？')
    expect(reading.speechAct.act).toBe('hypothesis')
    expect(reading.speechAct.attributedTo).toBe('hypothetical')
    expect(reading.mayExecute).toBe(false)
    expect(reading.uncertainties).toContain('hypothetical_not_instruction')
  })

  it('reads a negated imperative as a retraction of that action', () => {
    const reading = read('不要删除刚才那条。')
    expect(reading.speechAct.act).toBe('retraction')
    expect(reading.speechAct.action).toBe('delete')
    expect(reading.speechAct.negation.scope).toBe('verb_phrase')
    expect(reading.responseMode).toBe('stop_previous')
    expect(reading.mayExecute).toBe(false)
  })

  it('tells a misread correction apart from a retraction', () => {
    const reading = read('我不是说要你现在就做。')
    expect(reading.speechAct.act).toBe('correction')
    expect(reading.responseMode).toBe('answer')
    expect(reading.mayExecute).toBe(false)
  })

  it('mutation: removing the negation turns the same words into a request', () => {
    // `binds` is the authorisation flag; `mayExecute` additionally waits for the
    // object, which is asked about when it cannot be resolved.
    const direct = read('把这段代码删掉。', [user('我的函数 parseConfig 总是返回 undefined。')])
    expect(direct.speechAct.act).toBe('request')
    expect(direct.speechAct.binds).toBe(true)
    expect(direct.mayExecute).toBe(true)

    const retracted = read('不要把这段代码删掉。', [user('我的函数 parseConfig 总是返回 undefined。')])
    expect(retracted.speechAct.act).toBe('retraction')
    expect(retracted.speechAct.binds).toBe(false)
    expect(retracted.mayExecute).toBe(false)
  })

  it('mutation: removing the quotation makes the same words the user request', () => {
    const quoted = read('他说“把这段代码改掉”。')
    expect(quoted.speechAct.attributedTo).toBe('quoted_other')
    expect(quoted.mayExecute).toBe(false)

    const direct = read('把这段代码改掉。', [user('我的函数 parseConfig 有问题。')])
    expect(direct.speechAct.attributedTo).toBe('user')
    expect(direct.speechAct.act).toBe('request')
  })
})

describe('D. compound, correction and withdrawal', () => {
  it('splits a compound request and keeps the first goal primary', () => {
    const reading = read('帮我看看这段代码，然后解释一下为什么报错。', [user('我的函数 parseConfig 总是返回 undefined。')])
    expect(reading.responseMode).toBe('split')
    expect(reading.primaryIntent).toBe('request')
    expect(reading.secondaryIntents.length).toBeGreaterThan(0)
  })

  it('records what a correction supersedes, and by whom', () => {
    const reading = read('不对，我说的是苏州不是杭州。', [user('我住在杭州。')])
    expect(reading.intentStatus).toBe('changed')
    expect(reading.supersedesMessageId).toBe(M(1))
  })

  it('does not claim a supersede link for an unrelated turn', () => {
    const reading = read('今天天气不错。', [user('我住在杭州。')])
    expect(reading.supersedesMessageId).toBeNull()
  })

  it('keeps "not_retrieved" different from "never told" in the slot evidence', () => {
    // A continuation inherits its topic as `inferred`. When the antecedent is a
    // specific message, that message id is recorded — provenance, not a claim
    // that the user said it in this turn.
    const reading = read('继续。', [assistant('要我继续讲原理吗？')])
    const topic = reading.entitiesAndSlots.find((slot) => slot.name === 'topic')
    expect(topic?.status).toBe('inferred')
    expect(topic?.evidenceMessageId).toBe(M(2))
    expect(topic?.evidenceMessageId).not.toBe(CURRENT)
  })
})

describe('E. unknown stays unknown', () => {
  it('returns unknown rather than guessing when nothing matches', () => {
    const reading = read('今天天气不错。')
    expect(reading.intentStatus).toBe('unknown')
    expect(reading.primaryIntent).toBe('ambiguous')
    // Unknown is answered, not interrogated: there is no action to get wrong.
    expect(reading.responseMode).toBe('answer')
    expect(reading.clarificationRequired).toBe(false)
  })

  it('keeps a bare retraction from inventing a new goal', () => {
    const reading = read('算了，不用了。')
    expect(reading.speechAct.act).toBe('retraction')
    expect(reading.responseMode).toBe('stop_previous')
  })
})

describe('F. local context is bounded and explicit', () => {
  it('reports which prior messages it actually read', () => {
    const context = readLocalContext({ content: '继续。', history: [user('帮我写个函数。', 1), assistant('要我继续写完吗？', 2)] })
    expect(context.evidence).toContain('prior_user_message')
    expect(context.evidence).toContain('prior_assistant_message')
    expect(context.evidence).toContain('assistant_offered_execute')
    expect(context.continuationTarget).toBe('execution')
  })

  it('does not treat unrelated history as agreement', () => {
    const context = readLocalContext({ content: '今天几号？', history: [assistant('要我继续写完吗？')] })
    expect(context.continuationTarget).toBe('none')
    expect(context.affirmation).toBe('none')
  })
})

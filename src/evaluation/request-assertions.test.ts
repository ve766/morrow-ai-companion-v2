import { describe, expect, it } from 'vitest'
import {
  RequestShapeError,
  checkCrossSessionIsolation,
  checkFailurePersistence,
  checkHistoryCompleteness,
  parseProviderRequest,
  selectRetainedHistory,
  type ProviderMessage
} from './request-assertions'

/**
 * These tests exist to prove the assertions can fail.
 *
 * A gate that only ever runs against correct code is not evidence of anything:
 * the previous version of `real-provider-conversation.ts` compared
 * `requestBytes` and searched the whole payload for a substring, and both of
 * those pass on a request that leaks a foreign conversation. The cases below
 * build exactly such a request and require the new checks to reject it.
 */

function payload(messages: ProviderMessage[], model = 'qwen2.5:0.5b'): string {
  return JSON.stringify({
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    body: { max_tokens: 2048, messages, model, stream: true }
  })
}

const system = (text: string): ProviderMessage => ({ role: 'system', content: text })

describe('request parsing', () => {
  it('rejects a payload that is not a serialized provider request', () => {
    expect(() => parseProviderRequest('')).toThrow(RequestShapeError)
    expect(() => parseProviderRequest('not json')).toThrow(RequestShapeError)
    expect(() => parseProviderRequest('{"body":{}}')).toThrow(RequestShapeError)
    expect(() => parseProviderRequest('{"endpoint":"x","body":{"model":"m","messages":[{"role":"user"}]}}')).toThrow(RequestShapeError)
  })

  it('keeps message order, roles and contents exactly as sent', () => {
    const parsed = parseProviderRequest(payload([
      system('sys'),
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' }
    ]))
    expect(parsed.messages.map((message) => `${message.role}:${message.content}`)).toEqual(['system:sys', 'user:u1', 'assistant:a1'])
    expect(parsed.model).toBe('qwen2.5:0.5b')
  })
})

describe('history completeness', () => {
  const history: ProviderMessage[] = [
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '回复一' },
    { role: 'user', content: '第二句' },
    { role: 'assistant', content: '回复二' }
  ]
  const expectation = {
    retained: history,
    dropped: [],
    currentUserMessage: '第三句'
  }

  it('accepts a request that carries every retained message in order', () => {
    const request = parseProviderRequest(payload([system('sys'), ...history, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(true)
    expect(outcome.failures).toEqual([])
  })

  it('fails when one retained message is missing', () => {
    const request = parseProviderRequest(payload([system('sys'), history[0]!, history[1]!, history[3]!, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('history message 2')
  })

  it('fails when the messages are in the wrong order, even though every message is present', () => {
    const swapped = [history[1]!, history[0]!, history[2]!, history[3]!]
    const request = parseProviderRequest(payload([system('sys'), ...swapped, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('history message 0')
  })

  it('fails when a role is wrong but the content is identical', () => {
    const wrongRole = [
      { role: 'assistant', content: '第一句' },
      { role: 'assistant', content: '回复一' },
      { role: 'user', content: '第二句' },
      { role: 'assistant', content: '回复二' }
    ]
    const request = parseProviderRequest(payload([system('sys'), ...wrongRole, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('history message 0')
  })

  it('fails when the current user turn is not last', () => {
    const request = parseProviderRequest(payload([system('sys'), { role: 'user', content: '第三句' }, ...history]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('final message')
  })

  it('fails when a message the bound should have dropped is still present', () => {
    const dropped = { role: 'user', content: '最旧的一句' }
    const request = parseProviderRequest(payload([system('sys'), dropped, ...history, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, { ...expectation, dropped: [dropped] })
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('should have dropped')
  })

  it('fails on an extra foreign message rather than ignoring it', () => {
    const request = parseProviderRequest(payload([system('sys'), ...history, { role: 'user', content: '别人的话' }, { role: 'user', content: '第三句' }]))
    const outcome = checkHistoryCompleteness(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('unexpected extra history message')
  })
})

describe('history bound applied to the retained set', () => {
  it('keeps the newest messages and reports the older ones as droppable', () => {
    const history: ProviderMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index.toString().padStart(2, '0')}`
    }))
    const { retained, dropped } = selectRetainedHistory(history, { maxMessages: 12, maxCharacters: 6000 })
    expect(retained).toHaveLength(12)
    expect(retained[0]!.content).toBe('message-08')
    expect(dropped).toHaveLength(8)
    expect(dropped.at(-1)!.content).toBe('message-07')
  })

  it('stops at the first message that would exceed the character budget', () => {
    const history: ProviderMessage[] = [
      { role: 'user', content: 'x'.repeat(80) },
      { role: 'user', content: 'y'.repeat(40) },
      { role: 'user', content: 'z'.repeat(40) }
    ]
    const { retained, dropped } = selectRetainedHistory(history, { maxMessages: 12, maxCharacters: 100 })
    expect(retained.map((message) => message.content[0])).toEqual(['y', 'z'])
    expect(dropped.map((message) => message.content[0])).toEqual(['x'])
  })
})

describe('cross-conversation isolation', () => {
  const foreignUserMessages = ['A 会话里的私密内容 SESSION_A_PRIVATE_SENTINEL_1']
  const foreignAssistantMessages = ['A 会话的回复 ASSISTANT_SENTINEL_1']
  const foreignSentinels = ['SESSION_A_PRIVATE_SENTINEL_1', 'ASSISTANT_SENTINEL_1']
  const expectation = {
    foreignUserMessages,
    foreignAssistantMessages,
    foreignSentinels,
    currentUserMessage: 'B 会话的第一句',
    requiredMemoryFragment: '林一住在杭州'
  }

  it('accepts a fresh conversation that carries memory but no history', () => {
    const request = parseProviderRequest(payload([
      system('Saved memories: 林一住在杭州，做后端开发。'),
      { role: 'user', content: 'B 会话的第一句' }
    ]))
    expect(checkCrossSessionIsolation(request, expectation).passed).toBe(true)
  })

  it('fails when the other conversation\'s user turn is carried over', () => {
    const request = parseProviderRequest(payload([
      system('Saved memories: 林一住在杭州'),
      { role: 'user', content: foreignUserMessages[0]! },
      { role: 'assistant', content: '好' },
      { role: 'user', content: 'B 会话的第一句' }
    ]))
    const outcome = checkCrossSessionIsolation(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('foreign user message leaked')
  })

  it('fails when only the other conversation\'s assistant reply is carried over', () => {
    const request = parseProviderRequest(payload([
      system('Saved memories: 林一住在杭州'),
      { role: 'assistant', content: foreignAssistantMessages[0]! },
      { role: 'user', content: 'B 会话的第一句' }
    ]))
    const outcome = checkCrossSessionIsolation(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('foreign assistant reply leaked')
  })

  it('fails when a foreign sentinel reaches the system prompt', () => {
    const request = parseProviderRequest(payload([
      system('Saved memories: 林一住在杭州; earlier the user said SESSION_A_PRIVATE_SENTINEL_1'),
      { role: 'user', content: 'B 会话的第一句' }
    ]))
    const outcome = checkCrossSessionIsolation(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('system prompt')
  })

  it('fails when the memory never reaches the request', () => {
    const request = parseProviderRequest(payload([
      system('Saved memories: []'),
      { role: 'user', content: 'B 会话的第一句' }
    ]))
    const outcome = checkCrossSessionIsolation(request, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('absent from the system prompt')
  })

  it('rejects the byte-length heuristic the previous version relied on', () => {
    // Same conversation leaked, but the payload is a different length, which
    // is the only thing the old check compared. It would have reported
    // "isolated" here.
    const leaked = payload([
      system('Saved memories: 林一住在杭州'),
      { role: 'user', content: foreignUserMessages[0]! },
      { role: 'assistant', content: '嗯' },
      { role: 'user', content: 'B 会话的第一句' }
    ])
    const clean = payload([
      system('Saved memories: 林一住在杭州'),
      { role: 'user', content: 'B 会话的第一句' }
    ])
    const bytesDiffer = Buffer.byteLength(leaked, 'utf8') !== Buffer.byteLength(clean, 'utf8')
    const oldCheckWouldPass = bytesDiffer
    const newCheckPasses = checkCrossSessionIsolation(parseProviderRequest(leaked), expectation).passed

    expect(oldCheckWouldPass).toBe(true)
    expect(newCheckPasses).toBe(false)
  })
})

describe('failed-turn persistence', () => {
  const expectation = { turnId: 'turn-3', userMessage: '你好。', expectUserStored: true }

  it('accepts a store holding only the user turn', () => {
    const stored = [{ role: 'user', body: '你好。', turnId: 'turn-3' }]
    expect(checkFailurePersistence(stored, expectation).passed).toBe(true)
  })

  it('fails when an assistant message survived the failure', () => {
    const stored = [
      { role: 'user', body: '你好。', turnId: 'turn-3' },
      { role: 'assistant', body: '伪造的成功回复', turnId: 'turn-3' }
    ]
    const outcome = checkFailurePersistence(stored, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('assistant message')
  })

  it('fails when the user turn was silently dropped', () => {
    expect(checkFailurePersistence([], expectation).passed).toBe(false)
  })

  it('fails when the stored user turn is not the text that was sent', () => {
    const stored = [{ role: 'user', body: '别的内容', turnId: 'turn-3' }]
    const outcome = checkFailurePersistence(stored, expectation)
    expect(outcome.passed).toBe(false)
    expect(outcome.failures.join('\n')).toContain('stored user message')
  })

  it('ignores turns that belong to another request id', () => {
    const stored = [
      { role: 'user', body: '你好。', turnId: 'turn-3' },
      { role: 'assistant', body: '上一轮的正常回复', turnId: 'turn-2' }
    ]
    expect(checkFailurePersistence(stored, expectation).passed).toBe(true)
  })
})

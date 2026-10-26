import { describe, expect, it } from 'vitest'
import { HISTORY_POLICY, retainedHistoryTail } from '../app/companion-service'
import { selectRetainedHistory, type ProviderMessage } from './request-assertions'

/**
 * The verifier and the chat path must reduce history with the same algorithm.
 *
 * Sharing `HISTORY_POLICY` alone was not enough: the numbers could match while
 * the loop differed, and the gate would then assert against a window the chat
 * path never produces. These cases pin the observable behaviour, and the last
 * block compares the two entry points directly so a future edit to one side
 * fails here instead of silently weakening the real-provider gate.
 */

function messages(lengths: number[]): ProviderMessage[] {
  return lengths.map((length, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(length) }))
}

describe('history bound semantics', () => {
  it('keeps everything when the history fits both budget and count', () => {
    const history = messages([3, 4, 5])
    const { retained, dropped } = selectRetainedHistory(history)
    expect(retained).toHaveLength(3)
    expect(dropped).toHaveLength(0)
    expect(retained.map((message) => message.content.length)).toEqual([3, 4, 5])
  })

  it('keeps the newest messages and drops a prefix, not an arbitrary subset', () => {
    const history = messages(Array.from({ length: 15 }, () => 1))
    const { retained, dropped } = selectRetainedHistory(history)
    expect(retained).toHaveLength(HISTORY_POLICY.maxMessages)
    expect(dropped).toHaveLength(3)
    // The dropped ones are exactly the oldest three, in original order.
    expect(dropped).toEqual(history.slice(0, 3))
  })

  it('stops at the first message that would exceed the character budget', () => {
    // Newest three cost 10+10+10; a fourth 10 would fit 40 <= 100 only if the
    // walk continued, so make the blocker large: 1000 characters.
    const history = messages([10, 1000, 10, 10, 10])
    const { retained, dropped } = selectRetainedHistory(history, { maxMessages: 12, maxCharacters: 100 })
    expect(retained.map((message) => message.content.length)).toEqual([10, 10, 10])
    // The 1000-character message and everything older than it stay out: the
    // bound is a suffix, so a message that does not fit ends the walk.
    expect(dropped.map((message) => message.content.length)).toEqual([10, 1000])
  })

  it('does not skip an oversized message to reach an older small one', () => {
    const history = messages([5, 5, 900, 5])
    const { retained, dropped } = selectRetainedHistory(history, { maxMessages: 12, maxCharacters: 100 })
    expect(retained.map((message) => message.content.length)).toEqual([5])
    expect(dropped).toHaveLength(3)
  })

  it('respects the message-count bound independently of the character budget', () => {
    const history = messages(Array.from({ length: 20 }, () => 2))
    const { retained } = selectRetainedHistory(history, { maxMessages: 3, maxCharacters: 6000 })
    expect(retained).toHaveLength(3)
    expect(retained).toEqual(history.slice(-3))
  })

  it('is a no-op on an empty history', () => {
    const { retained, dropped } = selectRetainedHistory([])
    expect(retained).toEqual([])
    expect(dropped).toEqual([])
  })
})

describe('the verifier and the chat path share one implementation', () => {
  it('selects the same messages for every generated shape', () => {
    const shapes = [
      [1],
      [1, 1],
      Array.from({ length: 12 }, () => 1),
      Array.from({ length: 13 }, () => 1),
      [0, 0, 0],
      [1, 5000, 1, 1],
      [6000],
      [5999, 2],
      [3000, 3000],
      [3000, 2999, 1],
      Array.from({ length: 40 }, (_, index) => (index * 137) % 400)
    ]
    for (const shape of shapes) {
      const history = messages(shape)
      const verifier = selectRetainedHistory(history)
      // The chat path measures `message.body`; the verifier measures `content`.
      // Both are the same character count, which is the point of the check.
      const production = retainedHistoryTail(history, (message) => message.content.length)
      expect(verifier.retained).toEqual(production)
      expect(verifier.retained.length + verifier.dropped.length).toBe(history.length)
      expect(history.slice(0, verifier.dropped.length)).toEqual(verifier.dropped)
    }
  })

  it('measures length the same way the chat path does, not in bytes', () => {
    // '杭州好' is 3 characters but 9 UTF-8 bytes, and '嗯' is 1 character but 3
    // bytes. Stored bodies are measured in characters: 1 + 3 = 4 fits a budget
    // of 4, while 3 + 9 = 12 would not. A switch to bytes fails this.
    const history: ProviderMessage[] = [{ role: 'user', content: '杭州好' }, { role: 'assistant', content: '嗯' }]
    const { retained } = selectRetainedHistory(history, { maxMessages: 12, maxCharacters: 4 })
    expect(retained).toHaveLength(2)
    expect(retained.map((message) => message.content)).toEqual(['杭州好', '嗯'])
  })
})

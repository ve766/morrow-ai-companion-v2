/**
 * Stage 5 acceptance: relationship continuity and state-driven expression
 * strategy through the production assembly.
 *
 * Objective assertions only (payload blocks, ledger state, recorded policy).
 * Whether a reply is *natural* is a human judgement and is not asserted here.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStack, systemText, type Stack } from '../../evals/stage-3/runner/harness'
import { deriveExpressionPolicy } from '../affective-state/expression-policy'
import { FEELING_BASELINE } from '../affective-state/feeling'

let openStacks: Stack[] = []
afterEach(() => {
  for (const stack of openStacks) {
    try {
      stack.close()
    } catch {
      // already closed
    }
  }
  openStacks = []
})

function open(): Stack {
  const stack = buildStack({ growth: true, exploration: true, reflection: true })
  openStacks.push(stack)
  return stack
}

async function send(stack: Stack, conversationId: string, content: string) {
  return stack.companion.sendChat({ conversationId, requestId: randomUUID(), content, includeSensitive: false }, () => undefined)
}

function lastEvaluation(stack: Stack, field: string): unknown {
  const row = stack.database.connection.prepare(
    "SELECT payload_json FROM event_journal WHERE event_type = 'turn.evaluated' ORDER BY rowid DESC LIMIT 1"
  ).get() as { payload_json: string }
  return JSON.parse(row.payload_json)[field]
}

describe('Stage 5: relationship continuity reaches the next real turn', () => {
  it('stores an agreed topic and injects it in a later turn', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '我们下次聊项目时间线。')
    // One mention is a candidate: not injected yet.
    expect(systemText(stack.provider.lastPayload)).not.toContain('项目时间线')
    const b = stack.companion.createConversation()
    await send(stack, b.id, '我们下次聊项目时间线。')
    const c = stack.companion.createConversation()
    await send(stack, c.id, '今天随便聊点什么吧。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('Continuity with this user')
    expect(system).toContain('项目时间线')
    expect(lastEvaluation(stack, 'relationshipThreads')).toBeGreaterThanOrEqual(1)
  })

  it('a withdrawn agreement does not touch the address preference (P0-A)', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    await send(stack, a.id, '我们下次聊项目时间线。')
    // "那个约定就算了" names an agreement, not the address. Retracting it must
    // leave the address alone — the old code retracted everything active.
    await send(stack, a.id, '那个约定就算了。')
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('"小林"')
    expect(system).not.toContain('项目时间线')
    // And the address can still be withdrawn explicitly.
    await send(stack, b.id, '不要这样称呼我。')
    const c = stack.companion.createConversation()
    await send(stack, c.id, '你好。')
    expect(systemText(stack.provider.lastPayload)).not.toContain('"小林"')
  })

  it('a corrected address replaces the old one in later turns', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '以后叫我小林。')
    await send(stack, a.id, '以后叫我阿林。')
    const b = stack.companion.createConversation()
    await send(stack, b.id, '你好。')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('"阿林"')
    expect(system).not.toContain('"小林"')
  })
})

describe('Stage 5: the internal state becomes a structured strategy, not adjectives', () => {
  const baseState = {
    stateId: 'feeling_state' as const,
    schemaVersion: 1 as const,
    engineVersion: 'v1',
    scope: 'short_term_cross_conversation_interaction' as const,
    values: { ...FEELING_BASELINE },
    attention: { explorationPriority: 0 },
    revision: 1,
    evaluatedAt: '2026-11-01T08:00:00.000Z',
    updatedAt: null,
    sourceEventId: null,
    evidenceRefs: [],
    confidenceScore: null,
    uncertainty: 'low' as const,
    lastEventType: null
  }
  const analysis: Record<string, unknown> = {
    intent: 'information_query',
    uncertainty: 'high',
    signals: { correction: false, negation: false, explicitGoal: false, explicitConstraint: false, explicitMemoryRequest: false, explicitMemorySaveRequest: false, explicitSelfFact: false, topicSwitch: false, changedMind: false }
  }

  it('an explicit request for a direct answer wins over warmth', () => {
    const policy = deriveExpressionPolicy({ state: baseState as never, analysis: analysis as never, wantsDirectAnswer: true })
    expect(policy.adviceMode).toBe('answer_directly')
    expect(policy.brevity).toBe('brief')
  })

  it('an uncertain reading prefers a clarifying question', () => {
    const policy = deriveExpressionPolicy({ state: baseState as never, analysis: analysis as never, wantsDirectAnswer: false })
    expect(policy.clarifyMode).toBe('prefer')
    expect(policy.questionBudget).toBeGreaterThan(0)
  })

  it('unresolved tension asks for acknowledgement before advice', () => {
    const tense = { ...baseState, values: { ...FEELING_BASELINE, tension: 0.2 } }
    const policy = deriveExpressionPolicy({ state: tense as never, analysis: { ...analysis, uncertainty: 'low' } as never, wantsDirectAnswer: false })
    expect(policy.adviceMode).toBe('acknowledge_first')
  })

  it('the strategy reaches the payload and the turn record without exposing state values', async () => {
    const stack = open()
    const a = stack.companion.createConversation()
    await send(stack, a.id, '先别解释，直接告诉我答案：现在几点？')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('Expression strategy for this reply')
    expect(system).toContain('answer it directly')
    expect(system).toContain('Do not expose internal state')
    expect(lastEvaluation(stack, 'expressionPolicy')).toBe('explicit_direct_request')
  })

  it('the strategy never rewrites the facts in the same payload', async () => {
    const stack = open()
    stack.memories.create('我对花生过敏。', 'personal')
    const a = stack.companion.createConversation()
    await send(stack, a.id, '直接说，我对什么过敏？')
    const system = systemText(stack.provider.lastPayload)
    expect(system).toContain('花生')
    expect(system).toContain('answer it directly')
  })
})

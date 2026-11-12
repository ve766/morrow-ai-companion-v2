import { describe, expect, it } from 'vitest'
import { buildTurnEvaluation, isTurnEvaluation, turnEvaluationEventPayload } from './turn-evaluation'
import { decideIntent } from './intent-decision'
import { evaluateAnswerEvidence } from './answer-evidence-evaluation'

const ids = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  userMessageId: '33333333-3333-4333-8333-333333333333'
}
const sha = 'a'.repeat(64)

function build(overrides: Partial<Parameters<typeof buildTurnEvaluation>[0]> = {}) {
  return buildTurnEvaluation({
    ...ids,
    decision: decideIntent({ content: '我住在哪里？', hasPriorTurn: false }),
    selectedMemoryIds: ['44444444-4444-4444-8444-444444444444'],
    conflictMemoryIds: [],
    omitted: 2,
    maximumSensitivity: 'personal',
    payloadSha256: sha,
    payloadCharacters: 1200,
    providerId: 'deepseek',
    model: 'deepseek-flash',
    providerOutcome: 'succeeded',
    answer: evaluateAnswerEvidence({
      reply: '你住在杭州。',
      callSucceeded: true,
      memories: [{ id: '44444444-4444-4444-8444-444444444444', content: '我住在杭州。' }]
    }),
    recordedAt: '2026-10-28T07:00:00.000Z',
    ...overrides
  })
}

describe('phase 2 E: turn evaluation ledger', () => {
  it('links intent, evidence, payload, provider and answer outcome in one record', () => {
    const evaluation = build()
    expect(isTurnEvaluation(evaluation)).toBe(true)
    expect(evaluation).toMatchObject({
      intent: { intent: 'information_query', legacyIntent: 'information_query' },
      retrieval: { selectedMemoryIds: ['44444444-4444-4444-8444-444444444444'], omitted: 2, maximumSensitivity: 'personal' },
      provider: { outcome: 'succeeded' },
      answer: { outcome: 'used_correctly' }
    })
    expect(evaluation.payload.sha256).toBe(sha)
  })

  it('rejects a record that cannot be traced', () => {
    expect(() => build({ payloadSha256: 'not-a-digest' })).toThrow()
    expect(() => build({ conversationId: 'not-a-uuid' })).toThrow()
    expect(() => build({ recordedAt: 'yesterday' })).toThrow()
  })

  it('writes a bounded journal payload without reply or memory text', () => {
    const evaluation = build()
    const payload = turnEvaluationEventPayload(evaluation)
    expect(Object.keys(payload).length).toBeLessThanOrEqual(32)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('我住在')
    expect(serialized.length).toBeLessThan(2000)
    expect(payload).toMatchObject({ intent: 'information_query', providerOutcome: 'succeeded', answerOutcome: 'used_correctly', selectedMemoryCount: 1 })
  })

  it('records a failed call without inventing an answer outcome', () => {
    const evaluation = build({ providerOutcome: 'failed', answer: null, selectedMemoryIds: [] })
    expect(evaluation.answer).toBeNull()
    expect(turnEvaluationEventPayload(evaluation)).toMatchObject({ providerOutcome: 'failed', answerOutcome: 'not_scored', answerScored: false })
  })

  it('rejects a malformed stored record', () => {
    const evaluation = build() as unknown as Record<string, unknown>
    expect(isTurnEvaluation({ ...evaluation, schemaVersion: 99 })).toBe(false)
    expect(isTurnEvaluation({ ...evaluation, provider: { providerId: 'x', model: 'y', outcome: 'maybe' } })).toBe(false)
    expect(isTurnEvaluation({ ...evaluation, answer: { outcome: 'made_up' } })).toBe(false)
  })
})

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import { createCognitiveFeelingEvent, feelingPromptGuidance } from './cognitive-feeling-engine'
import {
  FEELING_DIMENSIONS,
  applyFeelingEvent,
  createDefaultFeelingState,
  decayFeelingState,
  isCognitiveFeelingEvent,
  type CognitiveFeelingEvent
} from './feeling'

const origin = '2026-10-24T00:00:00.000Z'
const conversationId = '10000000-0000-4000-8000-000000000001'

function createEvent(content: string, history: Array<{ id: string; role: 'user' | 'assistant'; body: string }> = []): CognitiveFeelingEvent | null {
  const sourceMessageId = randomUUID()
  const turnId = randomUUID()
  const analysis = analyzeCognitiveTurn(content, history, sourceMessageId)
  return createCognitiveFeelingEvent({
    analysis,
    content,
    history,
    conversationId,
    sourceMessageId,
    idempotencyKey: turnId,
    occurredAt: origin
  })
}

describe('local computational feeling engine', () => {
  it('updates bounded interaction valence only for explicit feedback about Morrow', () => {
    const positive = createEvent('Thanks, that helped.')
    const negative = createEvent('That was not helpful.')
    expect(positive?.type).toBe('positive_feedback')
    expect(negative?.type).toBe('negative_feedback')
    const initial = createDefaultFeelingState(origin)
    const positiveState = applyFeelingEvent(initial, positive!, origin)
    const negativeState = applyFeelingEvent(initial, negative!, origin)
    expect(positiveState.values.valence).toBeGreaterThan(0)
    expect(negativeState.values.valence).toBeLessThan(0)
    expect(Math.abs(positiveState.values.valence)).toBeLessThanOrEqual(1)
    expect(Math.abs(negativeState.values.valence)).toBeLessThanOrEqual(1)
  })

  it('does not copy user sadness or anger into Morrow state', () => {
    for (const content of ['I feel sad and overwhelmed today.', 'I feel angry about my boss.']) {
      const event = createEvent(content)
      expect(event?.type).toBe('user_context')
      expect(event?.interpretation.target).toBe('user_context')
      expect(event?.proposedDeltas).toEqual({ valence: 0, activation: 0, tension: 0 })
      expect(event?.proposedAttentionDelta).toBe(0)
      const priorInteraction = applyFeelingEvent(
        createDefaultFeelingState(origin),
        createEvent('That answer was not helpful.')!,
        origin
      )
      const evaluatedAt = '2026-10-24T01:00:00.000Z'
      const expected = decayFeelingState(priorInteraction, evaluatedAt)
      const after = applyFeelingEvent(priorInteraction, event!, evaluatedAt)
      expect(after.values).toEqual(expected.values)
      expect(after.attention.explorationPriority).toBe(expected.attention.explorationPriority)
      const analysis = analyzeCognitiveTurn(content, [], event!.sourceMessageId)
      expect(feelingPromptGuidance(analysis, after, event)).toContain('not Morrow’s internal state')
    }
  })

  it('separates system corrections from user changes of mind', () => {
    const previousAssistantId = randomUUID()
    const history = [{ id: previousAssistantId, role: 'assistant' as const, body: 'Earlier answer.' }]
    const correction = createEvent('You misunderstood; I meant the 2025 plan.', history)
    const selfCorrection = createEvent('I was wrong about the date; it is Friday.', history)
    const changeOfMind = createEvent('I changed my mind. I would rather choose the other one.', history)
    expect(correction).toMatchObject({ type: 'system_correction', relatedAssistantMessageId: previousAssistantId })
    expect(selfCorrection).toBeNull()
    expect(changeOfMind?.type).toBe('preference_change')
    expect(changeOfMind?.proposedDeltas).toEqual({ valence: 0, activation: 0, tension: 0 })
    expect(changeOfMind?.proposedAttentionDelta).toBe(0)
    expect(isCognitiveFeelingEvent(correction)).toBe(true)
    expect(isCognitiveFeelingEvent(changeOfMind)).toBe(true)
  })

  it('does not treat a polite refusal as positive feedback and records explicit exploration separately', () => {
    expect(createEvent('No thanks.')).toBeNull()
    const event = createEvent('Let’s brainstorm three possible titles.')
    expect(event?.type).toBe('exploration_request')
    const after = applyFeelingEvent(createDefaultFeelingState(origin), event!, origin)
    expect(after.attention.explorationPriority).toBeGreaterThan(0)
    expect(after.values.valence).toBe(0)
    expect(after.values.tension).toBe(0)
    expect(feelingPromptGuidance(analyzeCognitiveTurn('Let’s brainstorm three possible titles.', [], event!.sourceMessageId), after, event)).toContain('Offer one relevant angle')
  })

  it('does not treat quoted or reported words and obvious sarcasm as the user’s feedback or affect', () => {
    const history = [{ id: randomUUID(), role: 'assistant' as const, body: 'Earlier answer.' }]
    expect(createEvent('Translate this quote: “You misunderstood me; your answer was wrong.”', history)).toBeNull()
    expect(createEvent('The phrase “Great answer” is in my draft; fix its punctuation.', history)).toBeNull()
    expect(createEvent('My friend said that I feel sad and overwhelmed; I am only quoting them.', history)).toBeNull()
    expect(createEvent('朋友说我很难过，我只是在转述这句话。', history)).toBeNull()
    expect(createEvent('Great answer—said no one ever.', history)).toBeNull()
  })

  it('keeps user-context events state-neutral and respects an explicit request for objective help', () => {
    const content = 'I need to vent. I feel sad, but do not comfort me; just list the objective steps.'
    const event = createEvent(content)
    expect(event).toMatchObject({ type: 'user_context', proposedDeltas: { valence: 0, activation: 0, tension: 0 }, proposedAttentionDelta: 0 })
    const state = applyFeelingEvent(createDefaultFeelingState(origin), event!, origin)
    expect(state.values).toEqual({ valence: 0, activation: 0, tension: 0 })
          expect(feelingPromptGuidance(analyzeCognitiveTurn(content, [], event!.sourceMessageId), state, event)).toContain('Follow explicit requests for objective help or no reassurance')
  })

  it('lets a recent independent exploration request narrowly influence a later exploratory reply', () => {
    const first = createEvent('Let’s brainstorm three possible titles.')!
    const initial = createDefaultFeelingState(origin)
    const afterFirst = applyFeelingEvent(initial, first, origin)
    const second = createEvent('Let’s explore two related names.')!
    const secondState = applyFeelingEvent(afterFirst, second, origin)
    const secondAnalysis = analyzeCognitiveTurn('Let’s explore two related names.', [], second.sourceMessageId)
    const withHistory = feelingPromptGuidance(secondAnalysis, secondState, second, afterFirst)
    const withoutHistory = feelingPromptGuidance(secondAnalysis, applyFeelingEvent(initial, second, origin), second, initial)

    expect(afterFirst.attention.explorationPriority).toBeGreaterThanOrEqual(0.04)
    expect(withHistory).toContain('A recent, separate exploration request is a weak continuity signal.')
    expect(withHistory).toContain('at most one optional, closely related angle')
    expect(withoutHistory).not.toContain('A recent, separate exploration request is a weak continuity signal.')
  })

  it('rejects tampered event weights and preserves the defined event profile', () => {
    const event = createEvent('That answer was not helpful.')!
    expect(isCognitiveFeelingEvent({ ...event, proposedDeltas: { ...event.proposedDeltas, valence: 0.2 } })).toBe(false)
    expect(isCognitiveFeelingEvent({ ...event, proposedAttentionDelta: 0.5 })).toBe(false)
  })

  it('weights low-confidence evidence conservatively and keeps every dimension bounded', () => {
    const event = createEvent('That answer was not helpful.')!
    const lowConfidence: CognitiveFeelingEvent = {
      ...event,
      id: randomUUID(),
      idempotencyKey: randomUUID(),
      interpretation: { ...event.interpretation, confidenceScore: 49 }
    }
    const lowConfidenceState = applyFeelingEvent(createDefaultFeelingState(origin), lowConfidence, origin)
    expect(lowConfidenceState.values).toEqual({ valence: 0, activation: 0, tension: 0 })
    expect(lowConfidenceState.attention.explorationPriority).toBe(0)
    let state = createDefaultFeelingState(origin)
    for (let index = 0; index < 100; index += 1) {
      const repeated = { ...event, id: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date(Date.parse(origin) + index * 1000).toISOString() }
      state = applyFeelingEvent(state, repeated, repeated.occurredAt)
      expect(state.values.valence).toBeGreaterThanOrEqual(-1)
      expect(state.values.valence).toBeLessThanOrEqual(1)
      expect(state.values.activation).toBeGreaterThanOrEqual(0)
      expect(state.values.activation).toBeLessThanOrEqual(1)
      expect(state.values.tension).toBeGreaterThanOrEqual(0)
      expect(state.values.tension).toBeLessThanOrEqual(1)
    }
  })

  it('decays affect and exploration attention on separate timescales', () => {
    const correction = createEvent('That answer was not helpful.')!
    const state = applyFeelingEvent(createDefaultFeelingState(origin), correction, origin)
    const sixHours = decayFeelingState(state, '2026-10-24T06:00:00.000Z')
    const byDimension = FEELING_DIMENSIONS.map((dimension) => Math.abs(sixHours.values[dimension] / state.values[dimension]))
    expect(byDimension[0]).toBeCloseTo(0.5, 3)
    expect(byDimension[1]).toBeLessThan(0.01)
    expect(byDimension[2]).toBeGreaterThan(0.8)

    const exploration = createEvent('Let’s brainstorm three possible titles.')!
    const attentionState = applyFeelingEvent(createDefaultFeelingState(origin), exploration, origin)
    const thirtySixHours = decayFeelingState(attentionState, '2026-10-25T12:00:00.000Z')
    expect(thirtySixHours.attention.explorationPriority).toBeCloseTo(attentionState.attention.explorationPriority / 2, 3)
  })

  it('lets recent correction pressure alter a later prompt without claiming a human emotion', () => {
    const correction = createEvent('That was wrong; you misunderstood the date.')!
    const state = applyFeelingEvent(createDefaultFeelingState(origin), correction, origin)
    const nextId = randomUUID()
    const analysis = analyzeCognitiveTurn('What was the date again?', [], nextId)
    const guidance = feelingPromptGuidance(analysis, state, null)
    expect(guidance).toContain('potentially stale signal')
    expect(guidance).toContain('must never override facts')
    expect(guidance).toContain('Do not describe it as human emotion or reveal its numbers.')
  })

  it('rejects hand-edited event deltas and misattributed targets', () => {
    const event = createEvent('Thanks, that helped.')!
    expect(isCognitiveFeelingEvent({
      ...event,
      proposedDeltas: { ...event.proposedDeltas, valence: -0.16 }
    })).toBe(false)
    expect(isCognitiveFeelingEvent({
      ...event,
      interpretation: { ...event.interpretation, target: 'user_context' }
    })).toBe(false)
  })
})

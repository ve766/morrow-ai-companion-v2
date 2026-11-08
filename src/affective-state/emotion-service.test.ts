import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import type { CognitiveHistoryMessage } from '../cognition/cognition'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { appraiseTurn } from './appraisal-engine'
import { EmotionService, deterministicEmotionId, type EmotionEventDraft } from './emotion-service'
import { mergeEmotionCandidates, createInitialAffectState, describeAffect, relevantEmotions } from './emotion-model'

const directories: string[] = []
const origin = '2026-11-08T01:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-emotion-'))
  directories.push(directory)
  const path = join(directory, 'morrow.sqlite3')
  let database = SqliteDatabase.open(path)
  let currentTime = origin
  const conversations = new ConversationService(new SqliteConversationRepository(database), () => currentTime)
  const emotions = new EmotionService(database, () => currentTime)
  const conversation = conversations.create()

  function turn(content: string, type?: 'positive_feedback' | 'negative_feedback' | 'system_correction' | 'exploration_request' | 'user_context', at = currentTime) {
    const history: CognitiveHistoryMessage[] = conversations.read(conversation.id).messages.map(({ id, role, body }) => ({ id, role, body }))
    const sourceMessageId = randomUUID()
    const turnId = randomUUID()
    const analysis = analyzeCognitiveTurn(content, history, sourceMessageId)
    conversations.appendMessage(conversation.id, 'user', content, turnId, {
      messageId: sourceMessageId,
      cognitiveObservation: { attempt: 1, analyzedAt: at, analysis }
    })
    const assistantId = randomUUID()
    conversations.appendMessage(conversation.id, 'assistant', 'Deterministic factual answer with a caveat.', turnId, { messageId: assistantId })
    const appraisal = appraiseTurn({
      content, analysis, at,
      ...(type ? { interactionEventType: type } : {}),
      sourceMessageId,
      assistantMessageId: assistantId
    })
    return { sourceMessageId, assistantId, turnId, analysis, appraisal, content, at }
  }

  function draftFor(item: ReturnType<typeof turn>): EmotionEventDraft {
    return {
      eventId: deterministicEmotionId(`test-event:${item.turnId}`),
      idempotencyKey: item.turnId,
      conversationId: conversation.id,
      sourceMessageId: item.sourceMessageId,
      assistantMessageId: item.assistantId,
      occurredAt: item.at,
      sourceKind: item.appraisal.sourceKind,
      topicTags: item.appraisal.topicTags,
      appraisal: item.appraisal,
      accepted: item.appraisal.accepted,
      confidence: item.appraisal.confidence,
      uncertainty: item.appraisal.uncertainty,
      conflict: item.appraisal.conflict
    }
  }

  return {
    directory, path, conversations, emotions, conversation, turn, draftFor,
    get database() { return database },
    setTime(value: string) { currentTime = value },
    reopen() { database.close(); database = SqliteDatabase.open(path) }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('durable emotion model', () => {
  it('persists a positive appraisal and restores the same revision after reopen', () => {
    const context = setup()
    try {
      const item = context.turn('谢谢，这个回答很有帮助。', 'positive_feedback')
      expect(item.appraisal.accepted.length).toBeGreaterThan(0)
      const draft = context.draftFor(item)
      expect(context.emotions.record(draft, item.assistantId, origin)).toBe(true)
      const before = context.emotions.snapshot(origin)
      expect(before.revision).toBe(1)
      expect(before.emotions.some((emotion) => emotion.family === 'joy')).toBe(true)
      expect(before.emotions.every((emotion) => emotion.sourceKind !== 'user_context')).toBe(true)
      context.reopen()
      const reopened = new EmotionService(context.database, () => origin)
      expect(reopened.snapshot(origin)).toEqual(before)
    } finally {
      context.database.close()
    }
  })

  it('is idempotent per turn and rejects a conflicting replay', () => {
    const context = setup()
    try {
      const item = context.turn('That answer was not helpful.', 'negative_feedback')
      const draft = context.draftFor(item)
      expect(context.emotions.record(draft, item.assistantId, origin)).toBe(true)
      expect(context.emotions.record(draft, item.assistantId, origin)).toBe(false)
      const conflicting = { ...draft, accepted: draft.accepted.map((candidate) => ({ ...candidate, intensity: 0.9 })) }
      expect(() => context.emotions.record(conflicting, item.assistantId, origin)).toThrow()
      expect(context.emotions.snapshot(origin).revision).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('keeps coexisting emotions and decays by family half-life', () => {
    const context = setup()
    try {
      const item = context.turn('我现在有点担心这个方案会不会失败，但我还是想继续探索。', 'exploration_request')
      const draft = context.draftFor(item)
      context.emotions.record(draft, item.assistantId, origin)
      const before = context.emotions.snapshot(origin)
      expect(before.emotions.length).toBeGreaterThanOrEqual(1)
      context.setTime('2026-11-10T01:00:00.000Z')
      const later = context.emotions.snapshot()
      expect(later.evaluatedAt).toBe('2026-11-10T01:00:00.000Z')
      for (const emotion of later.emotions) {
        const prior = before.emotions.find((entry) => entry.emotionId === emotion.emotionId)!
        expect(emotion.intensity).toBeLessThanOrEqual(prior.intensity)
      }
    } finally {
      context.database.close()
    }
  })

  it('regulates and rebuilds without resurrecting a retracted emotion', () => {
    const context = setup()
    try {
      const item = context.turn('That answer was wrong and I am disappointed.', 'negative_feedback')
      const draft = context.draftFor(item)
      context.emotions.record(draft, item.assistantId, origin)
      const state = context.emotions.snapshot(origin)
      const frustration = state.emotions.find((emotion) => emotion.family === 'frustration')
      expect(frustration).toBeTruthy()
      const regulated = context.emotions.regulate({ emotionId: frustration!.emotionId, kind: 'retracted', rationale: 'the concrete error was repaired', at: origin })
      expect(regulated.emotions.find((emotion) => emotion.emotionId === frustration!.emotionId)?.regulationState).toBe('retracted')
      // Force a projection rebuild by deleting the cached revision count.
      context.database.connection.prepare('UPDATE emotion_states SET dirty = 1 WHERE id = 1').run()
      const rebuilt = context.emotions.snapshot(origin)
      expect(rebuilt.emotions.find((emotion) => emotion.emotionId === frustration!.emotionId)?.regulationState).toBe('retracted')
    } finally {
      context.database.close()
    }
  })

  it('deletes emotion evidence with its conversation and clears all history', () => {
    const context = setup()
    try {
      const item = context.turn('谢谢，你这次回答得对。', 'positive_feedback')
      context.emotions.record(context.draftFor(item), item.assistantId, origin)
      expect(context.emotions.listEvents().length).toBe(1)
      expect(context.emotions.deleteConversation(context.conversation.id, origin)).toBe(1)
      expect(context.emotions.listEvents().length).toBe(0)
      expect(context.emotions.snapshot(origin).emotions.length).toBe(0)
      const second = context.conversations.create()
      const history: CognitiveHistoryMessage[] = []
      const sourceMessageId = randomUUID()
      const turnId = randomUUID()
      const analysis = analyzeCognitiveTurn('thanks that helped', history, sourceMessageId)
      context.conversations.appendMessage(second.id, 'user', 'thanks that helped', turnId, { messageId: sourceMessageId, cognitiveObservation: { attempt: 1, analyzedAt: origin, analysis } })
      const assistantId = randomUUID()
      context.conversations.appendMessage(second.id, 'assistant', 'ok', turnId, { messageId: assistantId })
      const appraisal = appraiseTurn({ content: 'thanks that helped', analysis, at: origin, interactionEventType: 'positive_feedback', sourceMessageId, assistantMessageId: assistantId })
      const draft: EmotionEventDraft = {
        eventId: deterministicEmotionId('clear-event'), idempotencyKey: turnId, conversationId: second.id,
        sourceMessageId, assistantMessageId: assistantId, occurredAt: origin, sourceKind: appraisal.sourceKind,
        topicTags: appraisal.topicTags, appraisal, accepted: appraisal.accepted, confidence: appraisal.confidence,
        uncertainty: appraisal.uncertainty, conflict: appraisal.conflict
      }
      context.emotions.record(draft, assistantId, origin)
      expect(context.emotions.clearHistory(origin).emotions.length).toBe(0)
      expect(context.emotions.listEvents().length).toBe(0)
    } finally {
      context.database.close()
    }
  })

  it('keeps user emotion out of Morrow sadness and filters unrelated emotion from a query', () => {
    const context = setup()
    try {
      const item = context.turn('我很难过，感觉整个人都撑不住了。', 'user_context')
      expect(item.appraisal.accepted.some((candidate) => candidate.family === 'sadness')).toBe(false)
      expect(item.appraisal.accepted.every((candidate) => candidate.sourceKind === 'user_context')).toBe(true)
      const draft = context.draftFor(item)
      context.emotions.record(draft, item.assistantId, origin)
      const state = context.emotions.snapshot(origin)
      const unrelated = relevantEmotions(state, '太阳系外行星的轨道共振')
      expect(unrelated.length).toBe(0)
      expect(describeAffect(state, '太阳系外行星的轨道共振')).toBe('')
    } finally {
      context.database.close()
    }
  })

  it('merges repeated same-topic candidates instead of stacking to certainty', () => {
    const at = origin
    const candidate = {
      family: 'frustration' as const,
      intensity: 0.4,
      valence: -0.5,
      arousal: 0.6,
      sourceKind: 'morrow_self_appraisal' as const,
      appraisal: { goalRelevance: 0.7, goalCongruence: -0.6, novelty: 0.4, agency: 0.7, certainty: 0.7, responsibility: 0.7, relationshipRelevance: 0.3, expectationGap: 0.8 },
      confidence: 0.7,
      uncertainty: 'medium' as const,
      topicTags: ['数据库'],
      evidenceRefs: [{ kind: 'conversation_message' as const, id: randomUUID(), role: 'user' as const }],
      decayProfile: { halfLifeHours: 12 },
      rationale: 'test',
      traitEligible: true
    }
    let state = createInitialAffectState(at)
    let index = 0
    state = mergeEmotionCandidates({ state, candidates: [candidate], eventId: randomUUID(), at, makeId: () => deterministicEmotionId(`merge-${index++}`) })
    const first = state.emotions[0]!
    state = mergeEmotionCandidates({ state, candidates: [candidate], eventId: randomUUID(), at, makeId: () => deterministicEmotionId(`merge-${index++}`) })
    expect(state.emotions.length).toBe(1)
    expect(state.emotions[0]!.emotionId).toBe(first.emotionId)
    expect(state.emotions[0]!.intensity).toBeLessThan(0.8)
  })
})

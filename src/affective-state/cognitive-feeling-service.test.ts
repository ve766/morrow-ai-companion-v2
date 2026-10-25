import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ApplicationError } from '../shared/errors'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import type { CognitiveHistoryMessage } from '../cognition/cognition'
import { createCognitiveFeelingEvent } from './cognitive-feeling-engine'
import { CognitiveFeelingService } from './cognitive-feeling-service'
import { ConversationService } from '../conversation/conversation-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'

const directories: string[] = []
const origin = '2026-10-24T00:00:00.000Z'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-feelings-'))
  directories.push(directory)
  const path = join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(path)
  let currentTime = origin
  const conversations = new ConversationService(new SqliteConversationRepository(database), () => currentTime)
  const feelingService = new CognitiveFeelingService(database, () => currentTime)
  const conversation = conversations.create()

  function addUserTurn(content: string, conversationId = conversation.id) {
    const history: CognitiveHistoryMessage[] = conversations.read(conversationId).messages.map(({ id, role, body }) => ({ id, role, body }))
    const sourceMessageId = randomUUID()
    const turnId = randomUUID()
    const analysis = analyzeCognitiveTurn(content, history, sourceMessageId)
    const record = { attempt: 1, analyzedAt: currentTime, analysis }
    const user = conversations.appendMessage(conversationId, 'user', content, turnId, {
      messageId: sourceMessageId,
      cognitiveObservation: record
    }).messages.find((message) => message.id === sourceMessageId)!
    const event = createCognitiveFeelingEvent({
      analysis,
      content,
      history,
      conversationId,
      sourceMessageId,
      idempotencyKey: turnId,
      occurredAt: currentTime
    })
    return { user, event, turnId, history, content, conversationId }
  }

  function addAssistantTurn(turn: ReturnType<typeof addUserTurn>) {
    return conversations.appendMessage(turn.conversationId, 'assistant', 'Deterministic offline response.', turn.turnId)
      .messages.find((message) => message.turnId === turn.turnId && message.role === 'assistant')!
  }

  return {
    directory,
    path,
    database,
    conversations,
    feelingService,
    conversation,
    addUserTurn,
    addAssistantTurn,
    setTime(value: string) { currentTime = value }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('persisted cognitive feeling state', () => {
  it('rejects a conflicting replay with the same idempotency key without changing state', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('That answer was not helpful.')
      const assistant = context.addAssistantTurn(turn)
      expect(context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)).toBe(true)
      const conflicting = createCognitiveFeelingEvent({
        analysis: analyzeCognitiveTurn('Thanks, that helped.', turn.history, turn.user.id),
        content: 'Thanks, that helped.',
        history: turn.history,
        conversationId: turn.conversationId,
        sourceMessageId: turn.user.id,
        idempotencyKey: turn.turnId,
        occurredAt: origin
      })
      expect(conflicting?.type).toBe('positive_feedback')
      const before = context.feelingService.snapshot(origin)
      expect(() => context.feelingService.recordCompletedTurn(conflicting!, assistant.id, origin)).toThrow()
      expect(context.feelingService.snapshot(origin)).toEqual(before)
    } finally {
      context.database.close()
    }
  })

  it('stores a completed event once and restores the same bounded state after database reopen', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('That answer was not helpful.')
      const assistant = context.addAssistantTurn(turn)
      expect(turn.event).not.toBeNull()
      expect(context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)).toBe(true)
      expect(context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)).toBe(false)
      const conflictingAnalysis = analyzeCognitiveTurn('Thanks, that helped.', turn.history, turn.user.id)
      const conflictingEvent = createCognitiveFeelingEvent({
        analysis: conflictingAnalysis,
        content: 'Thanks, that helped.',
        history: turn.history,
        conversationId: turn.conversationId,
        sourceMessageId: turn.user.id,
        idempotencyKey: turn.turnId,
        occurredAt: origin
      })
      expect(() => context.feelingService.recordCompletedTurn(conflictingEvent!, assistant.id, origin))
        .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
      const before = context.feelingService.snapshot(origin)
      expect(before).toMatchObject({ available: true, eventCount: 1, state: { revision: 1, lastEventType: 'negative_feedback' } })
      expect(before.state.values.valence).toBeLessThan(0)
      expect(before.state.values.tension).toBeGreaterThan(0)
      expect(before.recentEvents).toHaveLength(1)
      context.database.close()

      const reopened = SqliteDatabase.open(context.path)
      try {
        const recovered = new CognitiveFeelingService(reopened, () => origin).snapshot(origin)
        expect(recovered).toEqual(before)
        expect(reopened.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        reopened.close()
      }
    } finally {
      context.database.close()
    }
  })

  it('commits an assistant answer and its feeling revision in one SQLite transaction', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('Thanks, that helped.')
      expect(turn.event).not.toBeNull()
      const appended = context.conversations.appendMessage(turn.conversationId, 'assistant', 'A deterministic answer.', turn.turnId, {
        afterPersist: (saved) => {
          const assistant = saved.messages.find((message) => message.turnId === turn.turnId && message.role === 'assistant')
          if (!assistant) throw new Error('Missing committed answer.')
          expect(context.feelingService.recordCompletedTurnInTransaction(turn.event!, assistant.id, origin)).toBe(true)
        }
      })
      expect(appended.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(context.feelingService.snapshot(origin).eventCount).toBe(1)
    } finally {
      context.database.close()
    }
  })

  it('rolls back the answer if its cognitive event cannot be validated, allowing the chat layer to fall back safely', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('That answer was not helpful.')
      const invalidEvent = { ...turn.event!, idempotencyKey: randomUUID() }
      expect(() => context.conversations.appendMessage(turn.conversationId, 'assistant', 'A deterministic answer.', turn.turnId, {
        afterPersist: (saved) => {
          const assistant = saved.messages.find((message) => message.turnId === turn.turnId && message.role === 'assistant')
          if (!assistant) throw new Error('Missing answer.')
          context.feelingService.recordCompletedTurnInTransaction(invalidEvent, assistant.id, origin)
        }
      })).toThrow()
      expect(context.conversations.read(turn.conversationId).messages.map((message) => message.role)).toEqual(['user'])
      expect(context.feelingService.snapshot(origin).eventCount).toBe(0)
      context.conversations.appendMessage(turn.conversationId, 'assistant', 'A deterministic answer.', turn.turnId)
      expect(context.conversations.read(turn.conversationId).messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    } finally {
      context.database.close()
    }
  })

  it('replays same-timestamp events in committed order, independent of their random event IDs', () => {
    const context = setup()
    try {
      const negativeIds = Array.from({ length: 10 }, (_, index) =>
        `ffffffff-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
      for (const id of negativeIds) {
        const turn = context.addUserTurn('That answer was not helpful.')
        const assistant = context.addAssistantTurn(turn)
        context.feelingService.recordCompletedTurn({ ...turn.event!, id }, assistant.id, origin)
      }
      const positive = context.addUserTurn('Thanks, that helped.')
      const positiveAssistant = context.addAssistantTurn(positive)
      const positiveId = '00000000-0000-4000-8000-000000000001'
      context.feelingService.recordCompletedTurn({ ...positive.event!, id: positiveId }, positiveAssistant.id, origin)

      const committed = context.feelingService.snapshot(origin)
      expect(context.database.connection.prepare('SELECT event_id, sequence FROM cognitive_feeling_events ORDER BY sequence').all())
        .toEqual([...negativeIds, positiveId].map((event_id, index) => ({ event_id, sequence: index + 1 })))
      expect(committed.state.values.valence).toBeLessThan(-0.9)

      context.database.connection.prepare('UPDATE cognitive_feeling_state SET dirty = 1').run()
      expect(context.feelingService.snapshot(origin)).toEqual(committed)
    } finally {
      context.database.close()
    }
  })

  it('rebuilds missing projection revisions from the durable event log', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('Thanks, that helped.')
      const assistant = context.addAssistantTurn(turn)
      context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)
      const committed = context.feelingService.snapshot(origin)
      context.database.connection.prepare('DELETE FROM cognitive_feeling_revisions WHERE event_id = ?').run(turn.event!.id)

      expect(context.feelingService.snapshot(origin)).toEqual(committed)
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_revisions').get())
        .toEqual({ count: 1 })
    } finally {
      context.database.close()
    }
  })

  it('rebuilds state after conversation deletion so removed evidence cannot reappear', () => {
    const context = setup()
    try {
      const positive = context.addUserTurn('Thanks, that helped.')
      const positiveAnswer = context.addAssistantTurn(positive)
      context.feelingService.recordCompletedTurn(positive.event!, positiveAnswer.id, origin)

      const second = context.conversations.create()
      context.setTime('2026-10-24T00:00:01.000Z')
      const negative = context.addUserTurn('That answer was not helpful.', second.id)
      const negativeAnswer = context.addAssistantTurn(negative)
      context.feelingService.recordCompletedTurn(negative.event!, negativeAnswer.id, '2026-10-24T00:00:01.000Z')
      expect(context.feelingService.snapshot('2026-10-24T00:00:01.000Z').state.values.valence).toBeLessThan(0)

      context.conversations.delete(second.id)
      const rebuilt = context.feelingService.snapshot('2026-10-24T00:00:02.000Z')
      expect(rebuilt.eventCount).toBe(1)
      expect(rebuilt.state.values.valence).toBeGreaterThan(0)
      expect(context.database.connection.prepare('SELECT dirty FROM cognitive_feeling_state WHERE id = 1').get()).toEqual({ dirty: 0 })
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_revisions').get()).toEqual({ count: 1 })
    } finally {
      context.database.close()
    }
  })

  it('clears only cognitive observations and state, preserving conversations and their messages', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('Let’s brainstorm a few names.')
      const assistant = context.addAssistantTurn(turn)
      context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)
      const cleared = context.feelingService.clearHistory()
      expect(cleared).toMatchObject({ available: true, eventCount: 0, state: { revision: 0, sourceEventId: null } })
      expect(cleared.state.values).toEqual({ valence: 0, activation: 0, tension: 0 })
      expect(cleared.state.attention).toEqual({ explorationPriority: 0, sourceEventId: null, updatedAt: null, evidenceRefs: [] })
      expect(context.conversations.read(context.conversation.id).messages).toHaveLength(2)
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()).toEqual({ count: 0 })
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_revisions').get()).toEqual({ count: 0 })
    } finally {
      context.database.close()
    }
  })

  it('rolls back a failed cognitive clear, returns a safe storage error, and remains idempotent', () => {
    const context = setup()
    try {
      const turn = context.addUserTurn('Let’s brainstorm a few names.')
      const assistant = context.addAssistantTurn(turn)
      context.feelingService.recordCompletedTurn(turn.event!, assistant.id, origin)
      const before = context.feelingService.snapshot(origin)
      context.database.connection.exec(`
        CREATE TRIGGER reject_cognitive_clear BEFORE DELETE ON cognitive_turn_observations
        BEGIN SELECT RAISE(ABORT, 'private test marker'); END;
      `)

      expect(() => context.feelingService.clearHistory()).toThrowError(ApplicationError)
      expect(() => context.feelingService.clearHistory()).toThrowError('STORAGE_ERROR')
      expect(context.feelingService.snapshot(origin)).toEqual(before)
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_events').get()).toEqual({ count: 1 })
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()).toEqual({ count: 1 })
      expect(context.conversations.read(context.conversation.id).messages).toHaveLength(2)

      context.database.connection.exec('DROP TRIGGER reject_cognitive_clear')
      const cleared = context.feelingService.clearHistory()
      expect(cleared).toMatchObject({ available: true, eventCount: 0, state: { revision: 0, sourceEventId: null } })
      expect(context.feelingService.clearHistory()).toMatchObject({ available: true, eventCount: 0, state: { revision: 0, sourceEventId: null } })
      expect(context.conversations.read(context.conversation.id).messages).toHaveLength(2)
    } finally {
      context.database.close()
    }
  })
})

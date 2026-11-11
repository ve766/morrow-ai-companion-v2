import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from './database'
import { SqliteTurnStateRepository } from './turn-state-repository'

describe('turn trace repository', () => {
  it('stores ordered, bounded trace events for a conversation', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const repository = new SqliteTurnStateRepository(database)
      const base = {
        turnId: '11111111-1111-4111-8111-111111111111',
        conversationId: '22222222-2222-4222-8222-222222222222',
        occurredAt: '2026-11-06T10:00:00.000Z',
        summary: null
      }
      repository.appendTrace({
        ...base,
        eventId: 'event-1',
        sequence: 1,
        stage: 'turn_received',
        status: 'completed',
        moduleId: 'app/companion-service',
        reason: null,
        durationMs: null
      })
      repository.appendTrace({
        ...base,
        eventId: 'event-2',
        sequence: 2,
        stage: 'provider_request',
        status: 'started',
        moduleId: 'providers/openai-compatible',
        reason: null,
        durationMs: 0
      })
      repository.appendTrace({
        ...base,
        eventId: 'event-3',
        sequence: 3,
        stage: 'provider_request',
        status: 'failed',
        moduleId: 'providers/openai-compatible',
        reason: 'PROVIDER_TIMEOUT',
        durationMs: 42
      })
      repository.appendTrace({
        ...base,
        eventId: 'event-4',
        sequence: 4,
        stage: 'cognition_analysis',
        status: 'skipped',
        moduleId: 'cognition/analysis',
        reason: 'analysis_unavailable',
        durationMs: null
      })
      const trace = repository.listForConversation(base.conversationId)
      expect(trace.map((event) => event.eventId)).toEqual(['event-1', 'event-2', 'event-3', 'event-4'])
      expect(trace.map((event) => event.status)).toEqual(['completed', 'started', 'failed', 'skipped'])
      expect(trace[2]).toMatchObject({
        stage: 'provider_request',
        status: 'failed',
        moduleId: 'providers/openai-compatible',
        reason: 'PROVIDER_TIMEOUT',
        durationMs: 42
      })
      repository.deleteTraceForConversation(base.conversationId)
      expect(repository.listForConversation(base.conversationId)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('caps a conversation read at 200 events', () => {
    const database = SqliteDatabase.open(':memory:')
    try {
      const repository = new SqliteTurnStateRepository(database)
      const conversationId = '33333333-3333-4333-8333-333333333333'
      for (let sequence = 1; sequence <= 205; sequence += 1) {
        repository.appendTrace({
          eventId: `cap-${sequence}`,
          turnId: '44444444-4444-4444-8444-444444444444',
          conversationId,
          sequence,
          occurredAt: `2026-11-06T10:00:${String(sequence % 60).padStart(2, '0')}.${String(sequence).padStart(3, '0')}Z`,
          stage: 'provider_delta',
          status: 'completed',
          moduleId: 'providers/openai-compatible',
          reason: null,
          durationMs: 1,
          summary: null
        })
      }
      expect(repository.listForConversation(conversationId)).toHaveLength(200)
    } finally {
      database.close()
    }
  })
})

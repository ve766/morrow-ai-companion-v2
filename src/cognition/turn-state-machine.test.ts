import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canTransition, IllegalTurnTransition, isTerminalTurnState, TURN_STATES } from './turn-state-machine'
import { SqliteTurnStateRepository } from '../persistence/turn-state-repository'
import { SqliteDatabase } from '../persistence/database'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function openDatabase(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-turn-state-'))
  return SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
}

describe('turn state machine contract', () => {
  it('accepts the documented happy path and rejects a skipped phase', () => {
    expect(canTransition(null, 'received')).toBe(true)
    expect(canTransition('received', 'context_ready')).toBe(true)
    expect(canTransition('context_ready', 'requesting')).toBe(true)
    expect(canTransition('requesting', 'response_received')).toBe(true)
    expect(canTransition('response_received', 'committed')).toBe(true)

    expect(canTransition('received', 'committed')).toBe(false)
    expect(canTransition('committed', 'requesting')).toBe(false)
    expect(canTransition(null, 'committed')).toBe(false)
  })

  it('treats a repeated state as an idempotent replay, not an error', () => {
    for (const state of TURN_STATES) expect(canTransition(state, state)).toBe(true)
  })

  it('only marks committed, failed and cancelled as terminal', () => {
    expect(isTerminalTurnState('committed')).toBe(true)
    expect(isTerminalTurnState('failed')).toBe(true)
    expect(isTerminalTurnState('cancelled')).toBe(true)
    expect(isTerminalTurnState('requesting')).toBe(false)
  })
})

describe('turn state persistence', () => {
  it('records a full lifecycle and refuses an illegal move', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnStateRepository(database)
      const turnId = randomUUID()
      const conversationId = randomUUID()
      const at = '2026-10-29T00:00:00.000Z'

      for (const state of ['received', 'context_ready', 'requesting', 'response_received', 'committed'] as const) {
        repository.enter({ turnId, conversationId, state, updatedAt: at, reason: null })
      }
      expect(repository.get(turnId)?.state).toBe('committed')

      expect(() => repository.enter({ turnId, conversationId, state: 'requesting', updatedAt: at, reason: null }))
        .toThrow(IllegalTurnTransition)
      // The rejected move did not overwrite the stored state.
      expect(repository.get(turnId)?.state).toBe('committed')
    } finally {
      database.close()
    }
  })

  it('keeps the first state when the same state is re-entered', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnStateRepository(database)
      const turnId = randomUUID()
      const conversationId = randomUUID()
      repository.enter({ turnId, conversationId, state: 'received', updatedAt: '2026-10-29T00:00:00.000Z', reason: null })
      repository.enter({ turnId, conversationId, state: 'context_ready', updatedAt: '2026-10-29T00:00:00.000Z', reason: null })
      repository.enter({ turnId, conversationId, state: 'requesting', updatedAt: '2026-10-29T00:00:00.000Z', reason: null })
      // Replaying the same state must not move the timestamp.
      repository.enter({ turnId, conversationId, state: 'requesting', updatedAt: '2026-10-29T09:00:00.000Z', reason: 'retry' })
      expect(repository.get(turnId)?.updatedAt).toBe('2026-10-29T00:00:00.000Z')
    } finally {
      database.close()
    }
  })

  it('drops the lifecycle when its conversation is deleted', () => {
    const database = openDatabase()
    try {
      const repository = new SqliteTurnStateRepository(database)
      const turnId = randomUUID()
      const conversationId = randomUUID()
      database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'b4', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z')
      repository.enter({ turnId, conversationId, state: 'received', updatedAt: '2026-10-29T00:00:00.000Z', reason: null })

      database.connection.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)

      expect(repository.get(turnId)).toBeNull()
    } finally {
      database.close()
    }
  })
})

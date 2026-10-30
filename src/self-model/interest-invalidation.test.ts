/**
 * Evidence invalidation and reversal semantics.
 *
 * Two derived-data paths used to be one-way:
 *
 *   - reflection records a saved memory as interest evidence, but only *message*
 *     and *conversation* deletion cleaned the ledger. Retracting, deleting or
 *     correcting the memory left the evidence in place, so an interest could stay
 *     active and reach the next prompt on a fact the user had taken back.
 *   - a reversal was written as `counter` but never read: `derivedStatus` only
 *     looked at support and conversations, so "我不喜欢了" could not suspend an
 *     active interest.
 *
 * These tests are on real SQLite (migrations included), not on mocks: the cleanup
 * is implemented in triggers, and a mock would prove nothing about them.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemoryService } from '../memory/memory-service'
import { EventLogService } from '../persistence/event-log'
import { InterestService, SqliteInterestRepository } from './interest-service'
import { BackupService } from '../persistence/backup-service'

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '33333333-3333-4111-8111-111111111111'

function openDatabase(): SqliteDatabase {
  return SqliteDatabase.open(':memory:')
}

function createStack(database: SqliteDatabase) {
  const clock = () => '2026-10-29T10:00:00.000Z'
  const events = new EventLogService(database, clock)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
  return { memories, interests, events }
}

function seedMessage(database: SqliteDatabase, conversationId: string, messageId: string, sequence: number) {
  database.connection.prepare('INSERT OR IGNORE INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'topic', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z')
  database.connection.prepare(
    'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(messageId, conversationId, 'user', '我在练咖啡拉花', '2026-10-29T09:00:00.000Z', sequence, messageId)
}

describe('memory-backed interest evidence is invalidated with the memory', () => {
  it('drops the evidence when the memory is retracted, and the interest with it', () => {
    const database = openDatabase()
    try {
      const { memories, interests } = createStack(database)
      const memory = memories.create('我在学咖啡拉花。')
      const messageId = '22222222-2222-4111-8111-000000000101'
      seedMessage(database, FIRST, messageId, 1)

      interests.observe({ conversationId: FIRST, messageId: memory.id, evidenceKind: 'memory', evidenceRevision: memory.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memory.currentText })
      interests.observe({ conversationId: SECOND, messageId, occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      const second = memories.create('最近一直在练咖啡拉花。')
      interests.observe({ conversationId: SECOND, messageId: second.id, evidenceKind: 'memory', evidenceRevision: second.revision, occurredAt: '2026-10-21T10:05:00.000Z', topicText: second.currentText })

      // Positive control: two sessions and three observations really do promote.
      expect(interests.list()[0]?.status).toBe('active')
      expect(interests.activeForContext()).toHaveLength(1)

      memories.retract(memory.id)

      const afterRetract = interests.list()[0]
      expect(afterRetract?.status).toBe('candidate')
      expect(afterRetract?.evidenceCount).toBe(2)
      expect(interests.evidenceLedger(afterRetract!.id).some((row) => row.ref === memory.id)).toBe(false)
      expect(interests.activeForContext()).toHaveLength(0)

      // The remaining memory evidence still stands, so the row is not deleted.
      memories.retract(second.id)
      expect(interests.list()[0]?.evidenceCount).toBe(1)
      expect(interests.list()[0]?.status).toBe('candidate')

      database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
      // With the last source gone the interest has no standing at all.
      expect(interests.list()).toHaveLength(0)
      const remaining = database.connection.prepare('SELECT COUNT(*) AS count FROM interest_evidence').get() as { count: number }
      expect(remaining.count).toBe(0)
    } finally {
      database.close()
    }
  })

  it('drops the evidence when the memory row is deleted outright', () => {
    const database = openDatabase()
    try {
      const { memories, interests } = createStack(database)
      const memory = memories.create('我在学咖啡拉花。')
      interests.observe({ conversationId: FIRST, messageId: memory.id, evidenceKind: 'memory', evidenceRevision: memory.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memory.currentText })
      expect(interests.list()[0]?.evidenceCount).toBe(1)

      memories.delete(memory.id)

      expect(interests.list()).toHaveLength(0)
      const remaining = database.connection.prepare('SELECT COUNT(*) AS count FROM interest_evidence').get() as { count: number }
      expect(remaining.count).toBe(0)
    } finally {
      database.close()
    }
  })

  it('ages out evidence from an older revision but keeps evidence from the current one', () => {
    const database = openDatabase()
    try {
      const { memories, interests } = createStack(database)
      const memory = memories.create('我在学咖啡拉花。')
      interests.observe({ conversationId: FIRST, messageId: memory.id, evidenceKind: 'memory', evidenceRevision: memory.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memory.currentText })
      expect(interests.list()[0]?.evidenceCount).toBe(1)

      // A confirmation is not a wording change: evidence must survive it.
      memories.confirm(memory.id)
      expect(interests.list()[0]?.evidenceCount).toBe(1)

      const corrected = memories.correct(memory.id, '我在学咖啡拉花和手冲。')
      // The observed wording no longer exists, so the observation no longer counts.
      expect(interests.list()).toHaveLength(0)

      // A new observation against the corrected revision is valid evidence.
      interests.observe({ conversationId: FIRST, messageId: corrected.id, evidenceKind: 'memory', evidenceRevision: corrected.revision, occurredAt: '2026-10-22T10:00:00.000Z', topicText: corrected.currentText })
      const rebuilt = interests.list()[0]
      expect(rebuilt?.evidenceCount).toBe(1)
      expect(interests.evidenceLedger(rebuilt!.id)[0]?.evidenceRevision).toBe(corrected.revision)
    } finally {
      database.close()
    }
  })

  it('keeps the invalidation after a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-interest-invalidation-'))
    const path = join(directory, 'morrow.sqlite3')
    try {
      const first = SqliteDatabase.open(path)
      const memories = new MemoryService(new SqliteMemoryRepository(first))
      const memory = memories.create('我在学咖啡拉花。')
      const clock = () => '2026-10-29T10:00:00.000Z'
      const events = new EventLogService(first, clock)
      const interests = new InterestService(new SqliteInterestRepository(first), events, clock)
      interests.observe({ conversationId: FIRST, messageId: memory.id, evidenceKind: 'memory', evidenceRevision: memory.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memory.currentText })
      const messageId = '22222222-2222-4111-8111-000000000111'
      seedMessage(first, SECOND, messageId, 1)
      interests.observe({ conversationId: SECOND, messageId, occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      expect(interests.list()[0]?.status).toBe('candidate')

      memories.retract(memory.id)
      first.close()

      const reopened = SqliteDatabase.open(path)
      try {
        const reopenedInterests = new InterestService(new SqliteInterestRepository(reopened), new EventLogService(reopened, clock), clock)
        const rows = reopenedInterests.list()
        expect(rows).toHaveLength(1)
        expect(rows[0]!.evidenceCount).toBe(1)
        expect(rows[0]!.status).toBe('candidate')
        expect(reopenedInterests.evidenceLedger(rows[0]!.id).some((row) => row.ref === memory.id)).toBe(false)
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('a backup of a demoted interest does not resurrect it', () => {
  it('carries the invalidation into the snapshot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-interest-backup-'))
    const sourcePath = join(directory, 'morrow.sqlite3')
    const target = join(directory, 'exports')
    try {
      const database = SqliteDatabase.open(sourcePath)
      const clock = () => '2026-10-29T10:00:00.000Z'
      const events = new EventLogService(database, clock)
      const memories = new MemoryService(new SqliteMemoryRepository(database))
      const interests = new InterestService(new SqliteInterestRepository(database), events, clock)
      const memory = memories.create('我在学咖啡拉花。')
      const messageId = '22222222-2222-4111-8111-000000000301'
      seedMessage(database, FIRST, messageId, 1)
      interests.observe({ conversationId: FIRST, messageId: memory.id, evidenceKind: 'memory', evidenceRevision: memory.revision, occurredAt: '2026-10-20T10:00:00.000Z', topicText: memory.currentText })
      interests.observe({ conversationId: SECOND, messageId, occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      const secondMemory = memories.create('最近一直在练咖啡拉花。')
      interests.observe({ conversationId: SECOND, messageId: secondMemory.id, evidenceKind: 'memory', evidenceRevision: secondMemory.revision, occurredAt: '2026-10-21T10:05:00.000Z', topicText: secondMemory.currentText })
      expect(interests.list()[0]?.status).toBe('active')

      memories.retract(memory.id)
      const demoted = interests.list()[0]!
      expect(demoted.status).toBe('candidate')

      const backup = new BackupService(database, sourcePath)
      const exported = await backup.export(target)
      expect(exported.status).toBe('created')

      // Restore = open the snapshot. It must not contain the retracted evidence,
      // and the interest must not come back as active.
      const restored = SqliteDatabase.open(join(exported.directory, 'morrow.sqlite3'))
      try {
        const restoredInterests = new InterestService(new SqliteInterestRepository(restored), new EventLogService(restored, clock), clock)
        const rows = restoredInterests.list()
        expect(rows).toHaveLength(1)
        expect(rows[0]!.status).toBe('candidate')
        expect(rows[0]!.evidenceCount).toBe(2)
        expect(restoredInterests.evidenceLedger(rows[0]!.id).some((row) => row.ref === memory.id)).toBe(false)
        expect(restoredInterests.activeForContext()).toHaveLength(0)
      } finally {
        restored.close()
      }
      database.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('reversal changes the interest state, not just the ledger', () => {
  function promote(interests: InterestService, database: SqliteDatabase) {
    const first = '22222222-2222-4111-8111-000000000201'
    const second = '22222222-2222-4111-8111-000000000202'
    const third = '22222222-2222-4111-8111-000000000203'
    seedMessage(database, FIRST, first, 1)
    seedMessage(database, SECOND, second, 1)
    seedMessage(database, SECOND, third, 2)
    interests.observe({ conversationId: FIRST, messageId: first, occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
    interests.observe({ conversationId: SECOND, messageId: second, occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
    interests.observe({ conversationId: SECOND, messageId: third, occurredAt: '2026-10-21T10:05:00.000Z', topicText: '今天又练了咖啡拉花' })
    return { first, second, third }
  }

  it('suspends an active interest as soon as the user reverses', () => {
    const database = openDatabase()
    try {
      const { interests } = createStack(database)
      promote(interests, database)
      expect(interests.list()[0]?.status).toBe('active')

      const reversed = interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000204', occurredAt: '2026-10-22T10:00:00.000Z', topicText: '我不想再练咖啡拉花了' })

      expect(reversed?.status).toBe('candidate')
      expect(reversed?.evidenceCount).toBe(3)
      expect(interests.activeForContext()).toHaveLength(0)
      const ledger = interests.evidenceLedger(reversed!.id)
      expect(ledger.filter((row) => row.polarity === 'counter')).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('lets a newer support clear an older reversal instead of being vetoed forever', () => {
    const database = openDatabase()
    try {
      const { interests } = createStack(database)
      promote(interests, database)
      interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000205', occurredAt: '2026-10-22T10:00:00.000Z', topicText: '我不想再练咖啡拉花了' })
      expect(interests.list()[0]?.status).toBe('candidate')

      const restored = interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000206', occurredAt: '2026-10-25T10:00:00.000Z', topicText: '我又开始练咖啡拉花了' })

      expect(restored?.status).toBe('active')
      expect(interests.activeForContext().map((row) => row.id)).toContain(restored!.id)
    } finally {
      database.close()
    }
  })

  it('recomputes from the remaining evidence when the counter source is deleted', () => {
    const database = openDatabase()
    try {
      const { interests } = createStack(database)
      promote(interests, database)
      const counterId = '22222222-2222-4111-8111-000000000207'
      seedMessage(database, SECOND, counterId, 3)
      interests.observe({ conversationId: SECOND, messageId: counterId, occurredAt: '2026-10-22T10:00:00.000Z', topicText: '我不想再练咖啡拉花了' })
      expect(interests.list()[0]?.status).toBe('candidate')

      database.connection.prepare('DELETE FROM messages WHERE id = ?').run(counterId)

      // The reversal is gone, so the three supporting observations stand again.
      expect(interests.list()[0]?.status).toBe('active')
      expect(interests.activeForContext()).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('does not double count a replayed reversal', () => {
    const database = openDatabase()
    try {
      const { interests } = createStack(database)
      promote(interests, database)
      const counterId = '22222222-2222-4111-8111-000000000208'
      for (let index = 0; index < 3; index += 1) {
        interests.observe({ conversationId: SECOND, messageId: counterId, occurredAt: '2026-10-22T10:00:00.000Z', topicText: '我不想再练咖啡拉花了' })
      }
      const ledger = interests.evidenceLedger(interests.list()[0]!.id)
      expect(ledger.filter((row) => row.polarity === 'counter')).toHaveLength(1)
      expect(interests.list()[0]?.status).toBe('candidate')
    } finally {
      database.close()
    }
  })
})

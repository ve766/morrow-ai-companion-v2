import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InterestService, SqliteInterestRepository } from './interest-service'
import { EventLogService } from '../persistence/event-log'
import { SqliteDatabase } from '../persistence/database'

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '33333333-3333-4111-8111-111111111111'

function openDatabase(): SqliteDatabase {
  return SqliteDatabase.open(':memory:')
}

function createService(database: SqliteDatabase, clock: () => string = () => '2026-10-29T10:00:00.000Z') {
  const events = new EventLogService(database, clock)
  return { interests: new InterestService(new SqliteInterestRepository(database), events, clock), events }
}

/** A message row is required for the deletion trigger to fire. */
function seedMessage(database: SqliteDatabase, conversationId: string, messageId: string, body: string, sequence: number) {
  database.connection.prepare('INSERT OR IGNORE INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'topic', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z')
  database.connection.prepare(
    'INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(messageId, conversationId, 'user', body, '2026-10-29T09:00:00.000Z', sequence, messageId)
}

describe('topic aggregation across sessions (B5 root fix)', () => {
  it('merges phrasing variants of one topic and promotes only at the documented threshold', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000001', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
      // Same entity, different verb and filler: must join the same interest.
      const second = interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000002', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      expect(interests.list()).toHaveLength(1)
      expect(second?.evidenceCount).toBe(2)
      // Two observations inside one conversation are still a candidate.
      expect(second?.status).toBe('candidate')

      const third = interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000003', occurredAt: '2026-10-22T10:00:00.000Z', topicText: '今天又练了咖啡拉花' })
      expect(interests.list()).toHaveLength(1)
      expect(third?.evidenceCount).toBe(3)
      expect(third?.conversationCount).toBe(2)
      expect(third?.status).toBe('active')
      expect(interests.activeForContext().map((record) => record.label)).toContain(third!.label)
    } finally {
      database.close()
    }
  })

  it('keeps a broad shared word from being read as evidence for a specific interest', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000011', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
      const broad = interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000012', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '都喜欢咖啡' })
      expect(interests.list()).toHaveLength(2)
      expect(broad?.evidenceCount).toBe(1)
      expect(broad?.status).toBe('candidate')
      const specific = interests.list().find((record) => record.label !== broad!.label)!
      expect(specific.evidenceCount).toBe(1)
    } finally {
      database.close()
    }
  })

  it('records a reversal as counter evidence instead of support', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000021', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我每天练习咖啡拉花' })
      const before = interests.list()[0]!
      const after = interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000022', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '我不想再练习咖啡拉花了' })
      expect(after!.evidenceCount).toBe(before.evidenceCount)
      expect(after!.status).toBe('candidate')
      const ledger = interests.evidenceLedger(after!.id)
      expect(ledger.filter((row) => row.polarity === 'counter')).toHaveLength(1)
      expect(ledger.filter((row) => row.polarity === 'support')).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('keeps a negated first mention from creating an interest at all', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      const result = interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000031', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我不喜欢咖啡拉花' })
      expect(result).toBeNull()
      expect(interests.list()).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it('does not let one topic borrow another topic’s evidence', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000041', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我在学咖啡拉花' })
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000042', occurredAt: '2026-10-20T10:01:00.000Z', topicText: '我在学古典钢琴' })
      interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000043', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000044', occurredAt: '2026-10-21T10:01:00.000Z', topicText: '还在练古典钢琴' })
      const records = interests.list()
      expect(records).toHaveLength(2)
      for (const record of records) {
        expect(record.evidenceCount).toBe(2)
        expect(record.conversationCount).toBe(2)
      }
    } finally {
      database.close()
    }
  })

  it('ignores a replayed observation instead of counting it twice', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      const observation = { conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000051', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我在学咖啡拉花' }
      interests.observe(observation)
      for (let index = 0; index < 5; index += 1) interests.observe(observation)
      const records = interests.list()
      expect(records).toHaveLength(1)
      expect(records[0]!.evidenceCount).toBe(1)
      expect(interests.evidenceLedger(records[0]!.id)).toHaveLength(1)
    } finally {
      database.close()
    }
  })

  it('keeps an ambiguous pair as two candidates instead of merging it', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000061', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我喜欢猫' })
      const other = interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000062', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '我喜欢狗' })
      expect(interests.list()).toHaveLength(2)
      expect(other?.evidenceCount).toBe(1)
    } finally {
      database.close()
    }
  })
})

describe('evidence ledger lifecycle', () => {
  it('drops the interest when its only source message is deleted', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      const messageId = '22222222-2222-4111-8111-000000000071'
      seedMessage(database, FIRST, messageId, '我在学咖啡拉花', 1)
      interests.observe({ conversationId: FIRST, messageId, occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我在学咖啡拉花' })
      // Positive control: the interest exists and carries one evidence row.
      expect(interests.list()).toHaveLength(1)
      expect(interests.list()[0]!.evidenceCount).toBe(1)

      database.connection.prepare('DELETE FROM messages WHERE id = ?').run(messageId)

      expect(interests.list()).toHaveLength(0)
      expect(interests.activeForContext()).toHaveLength(0)
      const remaining = database.connection.prepare('SELECT COUNT(*) AS count FROM interest_evidence').get() as { count: number }
      expect(remaining.count).toBe(0)
    } finally {
      database.close()
    }
  })

  it('demotes an active interest when the retracted evidence breaks the threshold', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      const firstMessage = '22222222-2222-4111-8111-000000000081'
      const secondMessage = '22222222-2222-4111-8111-000000000082'
      const thirdMessage = '22222222-2222-4111-8111-000000000083'
      seedMessage(database, FIRST, firstMessage, '我最近在学咖啡拉花', 1)
      seedMessage(database, SECOND, secondMessage, '还在练咖啡拉花', 1)
      seedMessage(database, SECOND, thirdMessage, '今天又练了咖啡拉花', 2)
      interests.observe({ conversationId: FIRST, messageId: firstMessage, occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
      interests.observe({ conversationId: SECOND, messageId: secondMessage, occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      const active = interests.observe({ conversationId: SECOND, messageId: thirdMessage, occurredAt: '2026-10-21T10:05:00.000Z', topicText: '今天又练了咖啡拉花' })
      // Positive control: it really was active before the retraction.
      expect(active?.status).toBe('active')

      database.connection.prepare('DELETE FROM messages WHERE id = ?').run(thirdMessage)
      const demoted = interests.list()
      expect(demoted).toHaveLength(1)
      expect(demoted[0]!.evidenceCount).toBe(2)
      expect(demoted[0]!.status).toBe('candidate')
      expect(interests.activeForContext()).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it('recovers the ledger and the promotion result after a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-interest-'))
    const path = join(directory, 'morrow.sqlite3')
    try {
      const first = SqliteDatabase.open(path)
      const created = createService(first).interests
      created.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-000000000091', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
      created.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000092', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      created.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-000000000093', occurredAt: '2026-10-21T10:05:00.000Z', topicText: '今天又练了咖啡拉花' })
      const before = created.list()[0]!
      expect(before.status).toBe('active')
      first.close()

      const second = SqliteDatabase.open(path)
      try {
        const reopened = createService(second).interests
        const after = reopened.list()
        expect(after).toHaveLength(1)
        expect(after[0]!.id).toBe(before.id)
        expect(after[0]!.evidenceCount).toBe(before.evidenceCount)
        expect(after[0]!.conversationCount).toBe(before.conversationCount)
        expect(after[0]!.status).toBe('active')
        expect(reopened.evidenceLedger(before.id)).toHaveLength(3)
      } finally {
        second.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('keeps the cached counters equal to a fold over the ledger', () => {
    const database = openDatabase()
    try {
      const { interests } = createService(database)
      interests.observe({ conversationId: FIRST, messageId: '22222222-2222-4111-8111-0000000000a1', occurredAt: '2026-10-20T10:00:00.000Z', topicText: '我最近在学咖啡拉花' })
      interests.observe({ conversationId: SECOND, messageId: '22222222-2222-4111-8111-0000000000a2', occurredAt: '2026-10-21T10:00:00.000Z', topicText: '还在练咖啡拉花' })
      const record = interests.list()[0]!
      const ledger = interests.evidenceLedger(record.id)
      expect(record.evidenceCount).toBe(ledger.filter((row) => row.polarity === 'support').length)
      expect(record.conversationCount).toBe(new Set(ledger.filter((row) => row.polarity === 'support').map((row) => row.conversationId)).size)
    } finally {
      database.close()
    }
  })
})

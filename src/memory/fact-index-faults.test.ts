import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from './memory-service'
import { FactMemoryService } from './fact-memory'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('fact index failure handling (A)', () => {
  it('a throwing reindex emits a sanitized degradation event and still finds the fact via the fallback scan', async () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-fault-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const events = new EventLogService(database)
    class BrokenIndex extends FactMemoryService {
      override reindexMemory(): void {
        throw new Error('MemoryDbError')
      }

      override lookupActive(): never[] {
        throw new Error('MemoryDbError')
      }
    }
    const broken = new BrokenIndex({ database })
    const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events, { factIndex: broken })
    const memory = memories.create('我对花生过敏。', 'personal')
    // The lifecycle write survived; the degradation is durably recorded.
    expect(memory.status).toBe('active')
    const event = database.connection.prepare(
      "SELECT payload_json FROM event_journal WHERE event_type = 'memory.fact_index.degraded' ORDER BY rowid DESC LIMIT 1"
    ).get() as { payload_json: string }
    const payload = JSON.parse(event.payload_json)
    expect(payload.errorCode).toBe('Error')
    expect(payload.attempt).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(payload)).not.toContain('花生')
    // The degraded fallback scan still answers the predicate question.
    const ctx = await memories.assembleContext('我对什么过敏来着？', 'personal')
    expect(ctx.selected.map((item) => item.content).join()).toContain('花生')
    database.close()
  })

  it('a degraded job is retried after its backoff and recovers the index', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-fault-retry-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const factMemory = new FactMemoryService({ database, clock: () => '2026-11-01T08:00:00.000Z' })
    const memoryId = '11111111-1111-4111-8111-111111111111'
    database.connection.prepare(
      "INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, sensitivity, updated_at, revision, confidence, last_confirmed_at) VALUES (?, ?, ?, 'user_explicit_input', 'active', '2026-11-01T07:00:00.000Z', 'personal', '2026-11-01T07:00:00.000Z', 1, 85, '2026-11-01T07:00:00.000Z')"
    ).run(memoryId, '我住在杭州。', '我住在杭州。')
    factMemory.reindexMemory(memoryId)
    database.connection.prepare(
      "UPDATE fact_index_jobs SET status = 'degraded', attempt_count = 1, last_error_code = 'MemoryDbError', next_retry_at = '2026-11-01T07:59:00.000Z' WHERE memory_id = ?"
    ).run(memoryId)
    expect(factMemory.retryDue([memoryId])).toEqual([memoryId])
    const row = database.connection.prepare(
      'SELECT status, attempt_count FROM fact_index_jobs WHERE memory_id = ?'
    ).get(memoryId) as { status: string; attempt_count: number }
    expect(row.status).toBe('indexed')
    expect(row.attempt_count).toBe(0)
    database.close()
  })

  it('a degraded job inside its backoff window is not hot-retried', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-fault-window-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const factMemory = new FactMemoryService({ database, clock: () => '2026-11-01T08:00:00.000Z' })
    const memoryId = '22222222-2222-4222-8222-222222222222'
    database.connection.prepare(
      "INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, sensitivity, updated_at, revision, confidence, last_confirmed_at) VALUES (?, ?, ?, 'user_explicit_input', 'active', '2026-11-01T07:00:00.000Z', 'personal', '2026-11-01T07:00:00.000Z', 1, 85, '2026-11-01T07:00:00.000Z')"
    ).run(memoryId, '我住在杭州。', '我住在杭州。')
    database.connection.prepare(
      "INSERT INTO fact_index_jobs(memory_id, status, attempt_count, last_error_code, next_retry_at, updated_at) VALUES (?, 'degraded', 2, 'MemoryDbError', '2026-11-01T08:30:00.000Z', '2026-11-01T08:00:00.000Z')"
    ).run(memoryId)
    expect(factMemory.retryDue([memoryId])).toEqual([])
    database.close()
  })

  it('B end-to-end: provenance flows from create through the revision into the fact ledger', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provenance-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const factMemory = new FactMemoryService({ database })
    const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, undefined, { factIndex: factMemory })
    const messageId = '33333333-3333-4333-8333-333333333333'
    const memory = memories.create('我对花生过敏。', 'personal', {
      provenance: { sourceMessageId: messageId, kind: 'message' }
    })
    const fact = database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM fact_records WHERE source_memory_id = ?'
    ).get(memory.id) as { source_message_id: string; provenance_kind: string }
    expect(fact.source_message_id).toBe(messageId)
    expect(fact.provenance_kind).toBe('message')
    const revision = database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM memory_revisions WHERE memory_id = ? AND revision = 1'
    ).get(memory.id) as { source_message_id: string; provenance_kind: string }
    expect(revision.source_message_id).toBe(messageId)
    // A correction WITHOUT provenance keeps the honest legacy marking on the
    // new revision instead of inheriting the old message id.
    const corrected = memories.correct(memory.id, '我对海鲜过敏。')
    const newRevision = database.connection.prepare(
      'SELECT source_message_id, provenance_kind FROM memory_revisions WHERE memory_id = ? AND revision = 2'
    ).get(corrected.id) as { source_message_id: string | null; provenance_kind: string }
    expect(newRevision.source_message_id).toBeNull()
    expect(newRevision.provenance_kind).toBe('legacy')
    database.close()
  })
})

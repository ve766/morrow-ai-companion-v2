/**
 * AUD45-P3-07: a withdrawn request must not close an open question with a bare
 * status update. The system closure is a decision (dismissed) with a route
 * terminal state and an audit event.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from './database'
import { EventLogService } from './event-log'
import { IntentReadingRepository } from './intent-reading-repository'
import { concernDigestOf } from '../self-model/reflection-concern'

describe('intent withdrawal closes open questions as a decision', () => {
  it('writes dismissed state, converges the route and audits the system decision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-intent-close-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    try {
      const events = new EventLogService(database)
      const conversationId = randomUUID()
      const runId = randomUUID()
      const findingId = randomUUID()
      const itemId = randomUUID()
      const statement = '我对「量子计算」还没有可靠的理解；这是我自己尚未解决的问题，想确认它是否值得继续弄清楚。'
      const at = new Date().toISOString()
      database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'intent', at, at)
      database.connection.prepare('INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(runId, 'manual', at, at, 1, 1, 1, 'completed')
      database.connection.prepare('INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(findingId, runId, 'open_question', statement, 40, '[]', at, `open_question:${findingId}`)
      database.connection.prepare("INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at) VALUES (?, 'pending_user', 'routed', 'open question', ?, 'open_question', ?, ?)")
        .run(findingId, runId, at, at)
      database.connection.prepare("INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at) VALUES (?, ?, 'open_question', 'open_question', 'legacy open question', 60, 'open', NULL, ?, '{}', ?, ?, NULL)")
        .run(itemId, `reflection:open_question:${concernDigestOf(statement)}`, conversationId, at, at)

      new IntentReadingRepository(database, events).retractConversation(conversationId, 'user_withdrew')

      const item = database.connection.prepare('SELECT status, decision, completed_at FROM cognitive_pending_items WHERE id = ?').get(itemId) as { status: string; decision: string | null; completed_at: string | null }
      expect(item.status).toBe('dropped')
      expect(item.decision).toBe('dismissed')
      expect(item.completed_at).toBeTruthy()
      expect(database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(findingId)).toEqual({ status: 'dismissed' })
      const audit = database.connection.prepare("SELECT actor, payload_json FROM event_journal WHERE event_type = 'pending.system_dismissed' AND subject_id = ?").get(itemId) as { actor: string; payload_json: string }
      expect(audit.actor).toBe('system')
      expect(JSON.parse(audit.payload_json)).toMatchObject({
        decision: 'dismissed',
        itemStatus: 'dropped',
        reason: 'intent_withdrawn',
        routeStatus: 'dismissed',
        routeResolution: 'resolved_by_concern',
        routesUpdated: 1
      })
      // No status-only path: the user decision audit is not forged.
      const userAudit = database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.decision'").get() as { n: number }
      expect(userAudit.n).toBe(0)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})

describe('intent withdrawal closure failure handling', () => {
  it('keeps the item open and records the failure when the decision write fails, then retries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-intent-close-fail-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    try {
      const events = new EventLogService(database)
      const conversationId = randomUUID()
      const itemId = randomUUID()
      const at = new Date().toISOString()
      database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'intent', at, at)
      database.connection.prepare("INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at) VALUES (?, 'conflict:x:a,b', 'open_question', 'open_question', 'legacy open question', 60, 'open', NULL, ?, '{}', ?, ?, NULL)")
        .run(itemId, conversationId, at, at)
      const readings = new IntentReadingRepository(database, events)

      database.connection.exec("CREATE TRIGGER intent_close_abort BEFORE UPDATE ON cognitive_pending_items BEGIN SELECT RAISE(ABORT, 'transient'); END;")
      expect(() => readings.retractConversation(conversationId, 'user_withdrew')).not.toThrow()
      expect(database.connection.prepare('SELECT status, decision FROM cognitive_pending_items WHERE id = ?').get(itemId)).toEqual({ status: 'open', decision: null })
      const failed = database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.system_dismiss_failed' AND subject_id = ?").get(itemId) as { n: number }
      expect(failed.n).toBe(1)

      database.connection.exec('DROP TRIGGER intent_close_abort')
      expect(() => readings.retractConversation(conversationId, 'user_withdrew')).not.toThrow()
      expect(database.connection.prepare('SELECT status, decision FROM cognitive_pending_items WHERE id = ?').get(itemId)).toEqual({ status: 'dropped', decision: 'dismissed' })
      const audit = database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.system_dismissed' AND subject_id = ?").get(itemId) as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})

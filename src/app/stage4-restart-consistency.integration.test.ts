/**
 * AUD45-P2-04: Stage 4 restart consistency on a real database file.
 *
 * Every assertion here runs after closing every connection and reopening the
 * same file through `SqliteDatabase.open` — not by re-selecting from the same
 * connection. P09 only covers memory/address/personality; this is the Stage 4
 * counterpart for finding, route, pending decision, candidate, goal, creation
 * key and audit.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { KnowledgeGapService } from '../self-model/knowledge-gap-service'
import { CompanionGoalService } from '../motivation/companion-goal'
import { PendingCognitionService } from '../cognition/pending-items'
import { SqlitePendingItemRepository } from '../persistence/cognitive-context-repository'
import { composeStartupReflectionServices, runStartupReflection } from './startup-composition'

let directory = ''
afterEach(() => {
  if (directory) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      // Windows can hold the file briefly.
    }
    directory = ''
  }
})

interface World {
  database: SqliteDatabase
  events: EventLogService
  path: string
}

function openWorld(): World {
  directory = mkdtempSync(join(tmpdir(), 'morrow-stage4-restart-'))
  const path = join(directory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(path)
  return { database, events: new EventLogService(database), path }
}

function seedGap(world: World, label: string): void {
  const conversationId = randomUUID()
  const turnId = randomUUID()
  const now = new Date().toISOString()
  world.database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'restart', now, now)
  const recorded = world.events.recordDeterministic(`restart-gap:${turnId}`, {
    sourceModule: 'cognition',
    eventType: 'cognition.knowledge_gap',
    actor: 'system',
    subjectType: 'interest',
    subjectId: label,
    correlationId: conversationId,
    payload: { label, owner: 'morrow', turnId }
  })
  new KnowledgeGapService(world.database).record({
    eventId: recorded.event.id,
    conversationId,
    turnId,
    label,
    confidence: 0.6,
    occurredAt: now
  })
}

function seedCandidate(world: World): { candidateId: string; messageId: string } {
  const conversation = randomUUID()
  const messageId = randomUUID()
  const now = new Date().toISOString()
  world.database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversation, 'goals', now, now)
  world.database.connection.prepare(
    "INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, 'user', ?, ?, 1, ?)"
  ).run(messageId, conversation, '我打算以后多读点书。', now, randomUUID())
  const goals = new CompanionGoalService(world.database, world.events)
  const result = goals.detectFromTurn({ conversationId: conversation, sourceMessageId: messageId, text: '我打算以后多读点书。' })
  if (!result.candidateId) throw new Error('candidate was not created')
  return { candidateId: result.candidateId, messageId }
}

function pendingService(world: World): PendingCognitionService {
  return new PendingCognitionService(new SqlitePendingItemRepository(world.database, world.events))
}

describe('stage 4 restart consistency', () => {
  it('keeps an open pending item decidable after a real close/reopen', () => {
    const first = openWorld()
    let pendingId = ''
    let routeFindingId = ''
    let goalId = ''
    let candidateId = ''
    try {
      seedGap(first, '量子计算')
      const services = composeStartupReflectionServices(first.database, first.events)
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      const item = first.database.connection.prepare('SELECT id, finding_id FROM cognitive_pending_items WHERE status = ?').get('open') as { id: string; finding_id: string }
      pendingId = item.id
      routeFindingId = item.finding_id

      const candidate = seedCandidate(first)
      candidateId = candidate.candidateId
      const goals = new CompanionGoalService(first.database, first.events)
      const accepted = goals.decideCandidate(candidateId, 'accept')
      expect(accepted.status).toBe('accepted')
      if (accepted.status !== 'accepted') throw new Error('candidate not accepted')
      goalId = accepted.goal.id
    } finally {
      first.database.close()
    }

    const second = openWorldFrom(first.path)
    try {
      const goals = new CompanionGoalService(second.database, second.events)
      const pending = pendingService(second)
      expect(goals.listCandidates()).toHaveLength(0)
      expect(goals.get(goalId)).toMatchObject({ id: goalId, status: 'active', owner: 'user' })
      const key = second.database.connection.prepare('SELECT goal_id FROM goal_creation_keys WHERE idempotency_key = ?').get(`goal:candidate:${candidateId}`) as { goal_id: string }
      expect(key.goal_id).toBe(goalId)
      const item = pending.get(pendingId)
      expect(item).toMatchObject({ status: 'open', decision: null, findingId: routeFindingId })
      expect(second.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(routeFindingId)).toEqual({ status: 'routed' })

      expect(pending.decide(pendingId, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      expect(pending.decide(pendingId, 'accepted')).toMatchObject({ status: 'unchanged' })
      expect(pending.decide(pendingId, 'rejected')).toMatchObject({ status: 'conflict', current: 'accepted' })
      expect(second.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(routeFindingId)).toEqual({ status: 'consumed' })
      const audit = second.database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.decision'").get() as { n: number }
      expect(audit.n).toBe(1)
      expect(second.database.connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    } finally {
      second.database.close()
    }
  })

  it('keeps a decided pending item and its route terminal after close/reopen', () => {
    const first = openWorld()
    let pendingId = ''
    let findingId = ''
    try {
      seedGap(first, '分布式共识')
      const services = composeStartupReflectionServices(first.database, first.events)
      runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      const row = first.database.connection.prepare('SELECT id, finding_id FROM cognitive_pending_items WHERE status = ?').get('open') as { id: string; finding_id: string }
      pendingId = row.id
      findingId = row.finding_id
      expect(pendingService(first).decide(pendingId, 'rejected')).toMatchObject({ status: 'decided', itemStatus: 'dropped' })
    } finally {
      first.database.close()
    }

    const second = openWorldFrom(first.path)
    try {
      const pending = pendingService(second)
      expect(pending.get(pendingId)).toMatchObject({ status: 'dropped', decision: 'rejected' })
      expect(second.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(findingId)).toEqual({ status: 'rejected' })
      expect(pending.decide(pendingId, 'rejected')).toMatchObject({ status: 'unchanged' })
      expect(pending.decide(pendingId, 'accepted')).toMatchObject({ status: 'conflict', current: 'rejected' })
      const audit = second.database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'pending.decision'").get() as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      second.database.close()
    }
  })
})

function openWorldFrom(path: string): World {
  const database = SqliteDatabase.open(path)
  return { database, events: new EventLogService(database), path }
}

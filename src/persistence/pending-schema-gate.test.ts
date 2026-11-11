/**
 * AUD45-P3-11: a database that could not apply v48 stays open for chat, but the
 * Stage 4 decision store must not issue SQL against missing columns and must not
 * masquerade as a generic storage failure.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyMigrations } from './migrations'
import { SqliteDatabase } from './database'
import { EventLogService } from './event-log'
import { SqlitePendingItemRepository } from './cognitive-context-repository'
import { PendingSchemaUnavailableError } from '../cognition/pending-items'
import { KnowledgeGapService } from '../self-model/knowledge-gap-service'
import { composeStartupReflectionServices, runStartupReflection } from '../app/startup-composition'

describe('pending store schema capability', () => {
  it('fails closed with SCHEMA_UPGRADE_REQUIRED when v48 could not be applied', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-v48-gate-'))
    const path = join(directory, 'morrow.sqlite3')
    try {
      const raw = new DatabaseSync(path)
      try {
        raw.exec('PRAGMA foreign_keys = ON')
        applyMigrations(raw, 47)
        // Make the v48 index creation fail so the migration rolls back and the
        // file stays at v47 — the real degraded-open shape.
        raw.exec('CREATE INDEX cognitive_pending_items_finding_idx ON cognitive_pending_items(status)')
      } finally {
        raw.close()
      }

      const database = SqliteDatabase.open(path)
      try {
        expect(database.schemaVersion).toBe(47)
        expect(database.cognitivePersistenceAvailable).toBe(false)
        const pending = new SqlitePendingItemRepository(database, new EventLogService(database))
        const draft = {
          id: '11111111-1111-4111-8111-111111111111',
          dedupeKey: 'conflict:residence:a,b',
          source: 'conflict' as const,
          kind: 'conflict_residence',
          summary: '两条记录矛盾。',
          priority: 70,
          conversationId: null,
          detail: {},
          createdAt: '2026-11-04T00:00:00.000Z'
        }
        expect(() => pending.upsert(draft)).toThrow(PendingSchemaUnavailableError)
        expect(() => pending.upsert(draft)).toThrow(/SCHEMA_UPGRADE_REQUIRED/)
        expect(() => pending.decide('11111111-1111-4111-8111-111111111111', 'accepted', draft.createdAt)).toThrow(PendingSchemaUnavailableError)
        // Reads stay safe: the pending table and its old columns still exist.
        expect(pending.findByDedupeKey(draft.dedupeKey)).toBeNull()

        // Startup reflection must report the degraded capability instead of
        // throwing or silently dropping the finding.
        const conversationId = randomUUID()
        const turnId = randomUUID()
        const now = new Date().toISOString()
        database.connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(conversationId, 'degraded', now, now)
        const events = new EventLogService(database)
        const recorded = events.recordDeterministic(`degraded-gap:${turnId}`, {
          sourceModule: 'cognition',
          eventType: 'cognition.knowledge_gap',
          actor: 'system',
          subjectType: 'interest',
          subjectId: '降级测试',
          correlationId: conversationId,
          payload: { label: '降级测试', owner: 'morrow', turnId }
        })
        new KnowledgeGapService(database).record({
          eventId: recorded.event.id,
          conversationId,
          turnId,
          label: '降级测试',
          confidence: 0.6,
          occurredAt: now
        })
        const services = composeStartupReflectionServices(database, events)
        expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })).toMatchObject({
          status: 'degraded',
          reason: 'schema_upgrade_required'
        })
      } finally {
        database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})

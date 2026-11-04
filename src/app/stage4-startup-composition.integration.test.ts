/**
 * Issue #43 work package B: the real startup composition boundary.
 *
 * This test calls `composeStartupReflectionServices` and
 * `runStartupReflection` — the same functions `src/app/index.ts` calls. It does
 * NOT call `reflection.run('startup')` or `findingRouter.ingestRun()` itself, so
 * the startup -> producer -> router -> persistence chain is the production one.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { KnowledgeGapService } from '../self-model/knowledge-gap-service'
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

function open(): { database: SqliteDatabase; events: EventLogService } {
  directory = mkdtempSync(join(tmpdir(), 'morrow-startup-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return { database, events: new EventLogService(database) }
}

function seedGap(database: SqliteDatabase, events: EventLogService, label: string, conversationId: string = randomUUID()): string {
  const turnId = randomUUID()
  const now = new Date().toISOString()
  database.connection.prepare('INSERT OR IGNORE INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, 'startup', now, now)
  const recorded = events.recordDeterministic(`startup-gap:${turnId}`, {
    sourceModule: 'cognition',
    eventType: 'cognition.knowledge_gap',
    actor: 'system',
    subjectType: 'interest',
    subjectId: label,
    correlationId: conversationId,
    payload: { label, owner: 'morrow', turnId }
  })
  new KnowledgeGapService(database).record({
    eventId: recorded.event.id,
    conversationId,
    turnId,
    label,
    confidence: 0.6,
    occurredAt: now
  })
  return conversationId
}

describe('real startup composition', () => {
  it('runs the production startup reflection and routes its finding to SQLite', () => {
    const { database, events } = open()
    try {
      seedGap(database, events, '量子计算')
      const services = composeStartupReflectionServices(database, events)
      const result = runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      expect(result.status).toBe('ran')

      const finding = database.connection.prepare(
        "SELECT id, kind FROM reflection_findings WHERE kind = 'open_question' ORDER BY created_at DESC LIMIT 1"
      ).get() as { id: string; kind: string } | undefined
      expect(finding).toBeDefined()
      const route = database.connection.prepare(
        'SELECT route, status FROM reflection_finding_routes WHERE finding_id = ?'
      ).get(finding!.id) as { route: string; status: string }
      expect(route).toMatchObject({ route: 'pending_user', status: 'routed' })
      const item = database.connection.prepare(
        'SELECT finding_id FROM cognitive_pending_items WHERE finding_id = ?'
      ).get(finding!.id) as { finding_id: string } | undefined
      expect(item?.finding_id).toBe(finding!.id)
      const audit = database.connection.prepare(
        "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.finding_routed' AND json_extract(payload_json, '$.findingId') = ?"
      ).get(finding!.id) as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      database.close()
    }
  })

  it('does not create a pending item when startup produces no finding', () => {
    const { database, events } = open()
    try {
      const services = composeStartupReflectionServices(database, events)
      const result = runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      expect(result.status).toBe('ran')
      const items = database.connection.prepare('SELECT COUNT(*) AS n FROM cognitive_pending_items').get() as { n: number }
      const routes = database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      expect({ items: items.n, routes: routes.n }).toEqual({ items: 0, routes: 0 })
    } finally {
      database.close()
    }
  })

  it('leaves no route/pending/audit partial state when startup ingestion fails', () => {
    const { database, events } = open()
    try {
      seedGap(database, events, '分布式共识')
      database.connection.exec("CREATE TRIGGER test_startup_abort BEFORE INSERT ON cognitive_pending_items BEGIN SELECT RAISE(ABORT, 'boom'); END;")
      const services = composeStartupReflectionServices(database, events)
      const result = runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      expect(result.status).toBe('failed')
      const routes = database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      const items = database.connection.prepare('SELECT COUNT(*) AS n FROM cognitive_pending_items').get() as { n: number }
      const routed = database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.finding_routed'").get() as { n: number }
      expect({ routes: routes.n, items: items.n, routed: routed.n }).toEqual({ routes: 0, items: 0, routed: 0 })
    } finally {
      database.close()
    }
  })

  it('a second startup gap for the same label keeps the run successful', () => {
    const { database, events } = open()
    try {
      const conversationId = seedGap(database, events, '量子计算')
      const services = composeStartupReflectionServices(database, events)
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      seedGap(database, events, '量子计算', conversationId)
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')

      const findings = database.connection.prepare("SELECT COUNT(*) AS n FROM reflection_findings WHERE kind = 'open_question'").get() as { n: number }
      const routes = database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      const items = database.connection.prepare('SELECT COUNT(*) AS n FROM cognitive_pending_items').get() as { n: number }
      const unrouted = database.connection.prepare(`
        SELECT COUNT(*) AS n FROM reflection_findings f
        LEFT JOIN reflection_finding_routes r ON r.finding_id = f.id
        WHERE r.finding_id IS NULL
      `).get() as { n: number }
      expect({ findings: findings.n, routes: routes.n, items: items.n, unrouted: unrouted.n }).toEqual({
        findings: 1,
        routes: 1,
        items: 1,
        unrouted: 0
      })
    } finally {
      database.close()
    }
  })

  it('returns skipped when the service rate-limits the run and never throws', () => {
    const { database, events } = open()
    try {
      const services = composeStartupReflectionServices(database, events)
      const at = new Date().toISOString()
      for (let index = 0; index < 6; index += 1) {
        database.connection.prepare(
          "INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status) VALUES (?, 'startup', ?, ?, 0, 0, 0, 'completed')"
        ).run(`${String(index).repeat(8)}-${String(index).repeat(4)}-4${String(index).repeat(3)}-8${String(index).repeat(3)}-${String(index).repeat(12)}`, at, at)
      }
      const result = runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      expect(result).toMatchObject({ status: 'skipped', reason: 'rate_limited' })
    } finally {
      database.close()
    }
  })

  it('reports producer failure without throwing and records the failed stage', () => {
    const { database, events } = open()
    try {
      const services = composeStartupReflectionServices(database, events)
      const failing = {
        run: () => { throw new Error('producer down') },
        findings: () => []
      } as unknown as typeof services.reflection
      const result = runStartupReflection({ reflection: failing, findingRouter: services.findingRouter })
      expect(result).toMatchObject({ status: 'failed', reason: 'producer_failed' })
      const audit = database.connection.prepare(
        "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.startup_failed'"
      ).get() as { n: number }
      expect(audit.n).toBe(1)
    } finally {
      database.close()
    }
  })

  it('keeps startup running when the lifecycle audit itself fails', () => {
    const { database, events } = open()
    try {
      const services = composeStartupReflectionServices(database, events)
      services.findingRouter.recordLifecycle = () => { throw new Error('audit down') }
      const result = runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter })
      expect(result.status).toBe('ran')
    } finally {
      database.close()
    }
  })

  it('repeated startup does not duplicate findings, routes or pending items', () => {
    const { database, events } = open()
    try {
      const services = composeStartupReflectionServices(database, events)
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      const counts = database.connection.prepare(`
        SELECT
          (SELECT COUNT(*) FROM cognitive_pending_items) AS items,
          (SELECT COUNT(*) FROM reflection_finding_routes) AS routes
      `).get() as { items: number; routes: number }
      expect(counts).toEqual({ items: 0, routes: 0 })
    } finally {
      database.close()
    }
  })
})

describe('startup composition repetition with findings', () => {
  it('does not duplicate a finding, route or item across repeated startups', () => {
    const { database, events } = open()
    try {
      seedGap(database, events, '重复启动')
      const services = composeStartupReflectionServices(database, events)
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      expect(runStartupReflection({ reflection: services.reflection, findingRouter: services.findingRouter }).status).toBe('ran')
      const counts = database.connection.prepare(`
        SELECT
          (SELECT COUNT(*) FROM reflection_findings) AS findings,
          (SELECT COUNT(*) FROM reflection_finding_routes) AS routes,
          (SELECT COUNT(*) FROM cognitive_pending_items) AS items
      `).get() as { findings: number; routes: number; items: number }
      expect(counts).toEqual({ findings: 1, routes: 1, items: 1 })
    } finally {
      database.close()
    }
  })
})

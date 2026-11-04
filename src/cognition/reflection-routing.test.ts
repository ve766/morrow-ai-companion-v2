import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { EventLogService } from '../persistence/event-log'
import { SqlitePendingItemRepository } from '../persistence/cognitive-context-repository'
import { PendingCognitionService } from './pending-items'
import { FINDING_ROUTES, MAX_PROMPT_HINTS, REFLECTION_FINDING_KINDS, ReflectionFindingRouter } from './reflection-routing'
import { concernDigestOf } from '../self-model/reflection-concern'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

interface World {
  database: SqliteDatabase
  router: ReflectionFindingRouter
  pending: PendingCognitionService
  events: EventLogService
  clock: { now: string }
  close: () => void
}

function openWorld(): World {
  directory = mkdtempSync(join(tmpdir(), 'morrow-routing-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const clock = { now: '2026-11-01T08:00:00.000Z' }
  const events = new EventLogService(database)
  const pending = new PendingCognitionService(new SqlitePendingItemRepository(database, events), () => globalThis.crypto.randomUUID(), () => clock.now)
  const router = new ReflectionFindingRouter({ database, pending, events, clock: () => clock.now })
  return { database, router, pending, events, clock, close: () => database.close() }
}

const RUN = '11111111-1111-4111-8111-111111111111'

function seedRun(database: SqliteDatabase): void {
  database.connection.prepare(
    "INSERT INTO reflection_runs(id, trigger_kind, started_at, finished_at, examined_turns, examined_events, findings_count, status) VALUES (?, 'manual', ?, ?, 1, 10, 0, 'completed')"
  ).run(RUN, '2026-11-01T07:00:00.000Z', '2026-11-01T07:00:10.000Z')
}

function seedFinding(database: SqliteDatabase, id: string, kind: string, statement: string, confidence: number, createdAt: string): void {
  database.connection.prepare(
    'INSERT INTO reflection_findings(id, run_id, kind, statement, confidence, evidence_json, created_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, RUN, kind, statement, confidence, '[]', createdAt, `${kind}:${id}`)
}

const uid = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`

describe('reflection finding routing (D-10)', () => {
  it('covers every finding kind the reflection service can emit, with no fallback', () => {
    expect(Object.keys(FINDING_ROUTES).sort()).toEqual([...REFLECTION_FINDING_KINDS].sort())
    for (const spec of Object.values(FINDING_ROUTES)) {
      expect(['context_hint', 'pending_user', 'audit_only']).toContain(spec.route)
      expect(spec.reason.length).toBeGreaterThan(10)
    }
  })

  it('routes kinds to their registry entries and creates a pending item only for pending-user kinds', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      seedFinding(world.database, uid(1), 'memory_gap', '最近的记录中有 2 次用户纠正；在相关话题上应降低断言置信度并先与用户核对。', 55, '2026-11-01T07:00:00.000Z')
      seedFinding(world.database, uid(2), 'intent_correction', '用户纠正过助手对上一轮的理解；下一轮应先复述自己的理解再回答。', 60, '2026-11-01T07:00:01.000Z')
      seedFinding(world.database, uid(3), 'interest_candidate', '记忆内容指向一个此前未出现的话题，已作为候选兴趣记录。', 40, '2026-11-01T07:00:02.000Z')
      world.router.ingestRun(RUN, [
        { id: uid(1), kind: 'memory_gap', statement: 'g', confidence: 55, createdAt: '2026-11-01T07:00:00.000Z' },
        { id: uid(2), kind: 'intent_correction', statement: '用户纠正过助手对上一轮的理解；下一轮应先复述自己的理解再回答。', confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' },
        { id: uid(3), kind: 'interest_candidate', statement: 'c', confidence: 40, createdAt: '2026-11-01T07:00:02.000Z' }
      ])
      const routes = world.database.connection.prepare('SELECT finding_id, route, status FROM reflection_finding_routes ORDER BY finding_id').all() as Array<{ finding_id: string; route: string; status: string }>
      expect(routes).toHaveLength(3)
      expect(routes.find((row) => row.finding_id === uid(1))).toMatchObject({ route: 'context_hint', status: 'routed' })
      expect(routes.find((row) => row.finding_id === uid(2))).toMatchObject({ route: 'pending_user' })
      expect(routes.find((row) => row.finding_id === uid(3))).toMatchObject({ route: 'audit_only' })
      const open = world.pending.listOpen()
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({ source: 'reflection', kind: 'intent_correction' })
    } finally {
      world.close()
    }
  })

  it('injects at most two hints, marks them, and expires stale ones by kind TTL', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const staleAt = '2026-10-30T00:00:00.000Z' // ~58h before the clock: past the 24h memory_gap ttl
      seedFinding(world.database, uid(1), 'memory_gap', '旧缺口。', 90, staleAt)
      seedFinding(world.database, uid(2), 'memory_gap', '新缺口 A。', 70, '2026-11-01T06:00:00.000Z')
      seedFinding(world.database, uid(3), 'memory_gap', '新缺口 B。', 60, '2026-11-01T06:30:00.000Z')
      seedFinding(world.database, uid(4), 'next_turn_suggestion', '存在未经确认的自我推断；下一轮先用一句话向用户确认。', 45, '2026-11-01T06:40:00.000Z')
      world.router.ingestRun(RUN, [
        { id: uid(1), kind: 'memory_gap', statement: '旧缺口。', confidence: 90, createdAt: staleAt },
        { id: uid(2), kind: 'memory_gap', statement: '新缺口 A。', confidence: 70, createdAt: '2026-11-01T06:00:00.000Z' },
        { id: uid(3), kind: 'memory_gap', statement: '新缺口 B。', confidence: 60, createdAt: '2026-11-01T06:30:00.000Z' },
        { id: uid(4), kind: 'next_turn_suggestion', statement: 's', confidence: 45, createdAt: '2026-11-01T06:40:00.000Z' }
      ])
      const block = world.router.promptBlock()
      expect(block).toContain('Internal hypotheses')
      expect(block).toContain('新缺口 A。')
      expect(block).toContain('新缺口 B。')
      expect(block).not.toContain('旧缺口。')
      // The cap is two: the third eligible hint stays routed, not injected.
      expect(block.split('\n')).toHaveLength(1 + 2)
      const statuses = world.database.connection.prepare('SELECT finding_id, status FROM reflection_finding_routes').all() as Array<{ finding_id: string; status: string }>
      expect(statuses.find((row) => row.finding_id === uid(1))).toMatchObject({ status: 'expired' })
      expect(statuses.find((row) => row.finding_id === uid(2))).toMatchObject({ status: 'injected' })
      expect(statuses.find((row) => row.finding_id === uid(3))).toMatchObject({ status: 'injected' })
      expect(statuses.find((row) => row.finding_id === uid(4))).toMatchObject({ status: 'routed' })
    } finally {
      world.close()
    }
  })

  it('records the hard cap so a third hint cannot sneak into one prompt', () => {
    expect(MAX_PROMPT_HINTS).toBe(2)
  })

  it('a rejected pending concern keeps its dropped status and never resurfaces', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const statement = '用户纠正过助手对上一轮的理解；下一轮应先复述自己的理解再回答。'
      seedFinding(world.database, uid(2), 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(2), kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      const open = world.pending.listOpen()
      expect(open).toHaveLength(1)
      expect(world.pending.decide(open[0]!.id, 'rejected')).toMatchObject({ status: 'decided', decision: 'rejected' })
      expect(world.pending.listOpen()).toHaveLength(0)
      // The same statement again (a later run, same dedupe key): the upsert
      // never resets status, so the dropped item stays dropped.
      world.router.ingestRun(RUN, [{ id: uid(2), kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:30:00.000Z' }])
      expect(world.pending.listOpen()).toHaveLength(0)
      const row = world.database.connection.prepare('SELECT status FROM cognitive_pending_items').get() as { status: string }
      expect(row.status).toBe('dropped')
    } finally {
      world.close()
    }
  })

  it('records unroutable kinds instead of guessing a route', () => {
    const world = openWorld()
    try {
      world.router.ingestRun(RUN, [{ id: uid(9), kind: 'made_up_kind', statement: 'x', confidence: 50, createdAt: '2026-11-01T07:00:00.000Z' }])
      const routes = world.database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      expect(routes.n).toBe(0)
      const events = world.database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.finding_unroutable'").get() as { n: number }
      expect(events.n).toBe(1)
    } finally {
      world.close()
    }
  })
  it('registers open_question as a pending-user route and links the item to the finding', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const statement = 'Morrow 注意到一个尚未解决的问题：长期项目的边界是否包括外部工具。'
      seedFinding(world.database, uid(2), 'open_question', statement, 55, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(2), kind: 'open_question', statement, confidence: 55, createdAt: '2026-11-01T07:00:01.000Z' }])
      expect(FINDING_ROUTES.open_question.route).toBe('pending_user')
      const open = world.pending.listOpen()
      expect(open).toHaveLength(1)
      expect(open[0]!.findingId).toBe(uid(2))
      const route = world.database.connection.prepare('SELECT route, status FROM reflection_finding_routes WHERE finding_id = ?').get(uid(2)) as { route: string; status: string }
      expect(route).toMatchObject({ route: 'pending_user', status: 'routed' })
    } finally {
      world.close()
    }
  })

  it('accepted, rejected and dismissed converge the item and route, with replay and conflict rules', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const statement = '用户纠正过助手对上一轮的理解。'
      seedFinding(world.database, uid(3), 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(3), kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      const item = world.pending.listOpen()[0]!
      expect(world.pending.decide(item.id, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      const accepted = world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(uid(3)) as { status: string }
      expect(accepted.status).toBe('consumed')
      expect(world.pending.decide(item.id, 'accepted')).toMatchObject({ status: 'unchanged' })
      expect(world.pending.decide(item.id, 'rejected')).toMatchObject({ status: 'conflict', current: 'accepted' })

      const second = uid(4)
      seedFinding(world.database, second, 'intent_correction', '另一条纠正。', 60, '2026-11-01T07:10:00.000Z')
      world.router.ingestRun(RUN, [{ id: second, kind: 'intent_correction', statement: '另一条纠正。', confidence: 60, createdAt: '2026-11-01T07:10:00.000Z' }])
      const secondItem = world.pending.listOpen()[0]!
      expect(world.pending.decide(secondItem.id, 'dismissed')).toMatchObject({ status: 'decided', itemStatus: 'dropped' })
      const dismissed = world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(second) as { status: string }
      expect(dismissed.status).toBe('dismissed')
    } finally {
      world.close()
    }
  })

  it('rolls the item back when the route terminal write fails', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      seedFinding(world.database, uid(5), 'intent_correction', '触发回滚。', 60, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(5), kind: 'intent_correction', statement: '触发回滚。', confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      const item = world.pending.listOpen()[0]!
      world.database.connection.exec("CREATE TRIGGER test_route_abort BEFORE UPDATE ON reflection_finding_routes BEGIN SELECT RAISE(ABORT, 'boom'); END;")
      try {
        expect(() => world.pending.decide(item.id, 'rejected')).toThrow()
      } finally {
        world.database.connection.exec('DROP TRIGGER test_route_abort')
      }
      const row = world.database.connection.prepare('SELECT status, decision FROM cognitive_pending_items WHERE id = ?').get(item.id) as { status: string; decision: string | null }
      expect(row).toMatchObject({ status: 'open', decision: null })
    } finally {
      world.close()
    }
  })

  it('writes a sanitized audit event for the decision', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const statement = '用户纠正过助手对上一轮的理解；不应写入审计原文。'
      seedFinding(world.database, uid(6), 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(6), kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      const item = world.pending.listOpen()[0]!
      world.pending.decide(item.id, 'rejected')
      const event = world.database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'pending.decision' ORDER BY rowid DESC LIMIT 1").get() as { payload_json: string }
      expect(event.payload_json).toContain('rejected')
      expect(event.payload_json).not.toContain('不应写入审计原文')
    } finally {
      world.close()
    }
  })

  it('rolls the route back when the pending item cannot be written', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      seedFinding(world.database, uid(7), 'intent_correction', '原子化测试。', 60, '2026-11-01T07:00:01.000Z')
      world.database.connection.exec("CREATE TRIGGER test_pending_abort BEFORE INSERT ON cognitive_pending_items BEGIN SELECT RAISE(ABORT, 'boom'); END;")
      try {
        expect(() => world.router.ingestRun(RUN, [{ id: uid(7), kind: 'intent_correction', statement: '原子化测试。', confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])).toThrow()
      } finally {
        world.database.connection.exec('DROP TRIGGER test_pending_abort')
      }
      const routes = world.database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      const items = world.database.connection.prepare('SELECT COUNT(*) AS n FROM cognitive_pending_items').get() as { n: number }
      const events = world.database.connection.prepare("SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.finding_routed'").get() as { n: number }
      expect({ routes: routes.n, items: items.n, events: events.n }).toEqual({ routes: 0, items: 0, events: 0 })
    } finally {
      world.close()
    }
  })

  it('refuses to decide a new item whose reflection route is missing', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      seedFinding(world.database, uid(8), 'intent_correction', '路由缺失测试。', 60, '2026-11-01T07:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: uid(8), kind: 'intent_correction', statement: '路由缺失测试。', confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      const item = world.pending.listOpen()[0]!
      world.database.connection.prepare('DELETE FROM reflection_finding_routes WHERE finding_id = ?').run(uid(8))
      expect(() => world.pending.decide(item.id, 'rejected')).toThrow(/PENDING_ROUTE_MISSING/)
      const row = world.database.connection.prepare('SELECT status, decision FROM cognitive_pending_items WHERE id = ?').get(item.id) as { status: string; decision: string | null }
      expect(row).toMatchObject({ status: 'open', decision: null })
    } finally {
      world.close()
    }
  })

  it('keeps the documented compatibility path for legacy items without a finding link', () => {
    const world = openWorld()
    try {
      const ids = world.pending.observeTurn({
        turnId: uid(11),
        conversationId: '11111111-1111-4111-8111-111111111111',
        at: '2026-01-01T00:00:00.000Z',
        status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }],
        blockedClaimKinds: []
      })
      expect(world.pending.decide(ids[0]!, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      const routeCount = world.database.connection.prepare('SELECT COUNT(*) AS n FROM reflection_finding_routes').get() as { n: number }
      expect(routeCount.n).toBe(0)
      const audit = world.database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'pending.decision'").get() as { payload_json: string }
      expect(JSON.parse(audit.payload_json)).toMatchObject({ routeStatus: null, routeResolution: 'unresolved', routesUpdated: 0 })
    } finally {
      world.close()
    }
  })

  it('converges a legacy item route by its stored concern digest', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const findingId = uid(8)
      const statement = '用户纠正过助手对上一轮的理解。'
      seedFinding(world.database, findingId, 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      world.database.connection.prepare(
        "INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at) VALUES (?, 'pending_user', 'routed', 'legacy route', ?, 'intent_correction', ?, ?)"
      ).run(findingId, RUN, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')
      const itemId = uid(9)
      world.database.connection.prepare(
        "INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at) VALUES (?, ?, 'reflection', 'intent_correction', 'legacy item', 40, 'open', NULL, NULL, '{}', ?, ?, NULL)"
      ).run(itemId, `reflection:intent_correction:${concernDigestOf(statement)}`, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')

      expect(world.pending.decide(itemId, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      expect(world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(findingId)).toEqual({ status: 'consumed' })
      const audit = world.database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'pending.decision' AND subject_id = ?").get(itemId) as { payload_json: string }
      expect(JSON.parse(audit.payload_json)).toMatchObject({
        routeStatus: 'consumed',
        routeResolution: 'resolved_by_concern',
        routesUpdated: 1
      })
    } finally {
      world.close()
    }
  })

  it('converges every route of a legacy concern adopted by a later observation', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const original = uid(8)
      const later = uid(9)
      const statement = '用户纠正过助手对上一轮的理解。'
      seedFinding(world.database, original, 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      seedFinding(world.database, later, 'intent_correction', statement, 60, '2026-11-01T07:10:01.000Z')
      world.database.connection.prepare(
        "INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at) VALUES (?, 'pending_user', 'routed', 'pre-upgrade route', ?, 'intent_correction', ?, ?)"
      ).run(original, RUN, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')
      const itemId = uid(7)
      world.database.connection.prepare(
        "INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at) VALUES (?, ?, 'reflection', 'intent_correction', 'legacy item', 40, 'open', NULL, NULL, '{}', ?, ?, NULL)"
      ).run(itemId, `reflection:intent_correction:${concernDigestOf(statement)}`, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')

      // A post-upgrade observation of the same concern adopts the legacy item.
      world.router.ingestRun(RUN, [{ id: later, kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:10:01.000Z' }])
      const adopted = world.pending.get(itemId)!
      expect(adopted.findingId).toBe(later)

      expect(world.pending.decide(itemId, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      const routes = world.database.connection.prepare('SELECT finding_id, status FROM reflection_finding_routes ORDER BY finding_id').all() as Array<{ finding_id: string; status: string }>
      expect(routes).toEqual([
        { finding_id: original, status: 'consumed' },
        { finding_id: later, status: 'consumed' }
      ])
      const audit = world.database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'pending.decision' AND subject_id = ?").get(itemId) as { payload_json: string }
      expect(JSON.parse(audit.payload_json)).toMatchObject({
        routeStatus: 'consumed',
        routeResolution: 'linked_with_siblings',
        routesUpdated: 2
      })
    } finally {
      world.close()
    }
  })

  it('does not guess a legacy route when the concern cannot be proven', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const findingId = uid(8)
      seedFinding(world.database, findingId, 'intent_correction', '另一条纠正。', 60, '2026-11-01T07:00:01.000Z')
      world.database.connection.prepare(
        "INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at) VALUES (?, 'pending_user', 'routed', 'legacy route', ?, 'intent_correction', ?, ?)"
      ).run(findingId, RUN, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')
      const itemId = uid(9)
      world.database.connection.prepare(
        "INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, finding_id, conversation_id, detail_json, created_at, updated_at, completed_at) VALUES (?, ?, 'reflection', 'intent_correction', 'legacy item', 40, 'open', NULL, NULL, '{}', ?, ?, NULL)"
      ).run(itemId, 'reflection:intent_correction:0000000000000000', '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')

      expect(world.pending.decide(itemId, 'rejected')).toMatchObject({ status: 'decided', itemStatus: 'dropped' })
      expect(world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(findingId)).toEqual({ status: 'routed' })
      const audit = world.database.connection.prepare("SELECT payload_json FROM event_journal WHERE event_type = 'pending.decision' AND subject_id = ?").get(itemId) as { payload_json: string }
      expect(JSON.parse(audit.payload_json)).toMatchObject({
        routeStatus: null,
        routeResolution: 'unresolved',
        routesUpdated: 0
      })
    } finally {
      world.close()
    }
  })

  it('requires a durable audit sink for decisions', () => {
    const world = openWorld()
    try {
      const legacyRepository = new SqlitePendingItemRepository(world.database, undefined as never)
      const legacy = new PendingCognitionService(legacyRepository, () => globalThis.crypto.randomUUID(), () => world.clock.now)
      const [id] = legacy.observeTurn({
        turnId: uid(12),
        conversationId: '11111111-1111-4111-8111-111111111111',
        at: '2026-01-01T00:00:00.000Z',
        status: 'succeeded',
        conflicts: [{ predicate: 'work', memoryIds: ['c', 'd'] }],
        blockedClaimKinds: []
      })
      expect(() => legacy.decide(id!, 'accepted')).toThrow(/PENDING_AUDIT_UNAVAILABLE/)
    } finally {
      world.close()
    }
  })

  it('ingests a second finding for the same concern without PENDING_LINK_MISMATCH', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const statement = '用户纠正过助手对上一轮的理解；下一轮应先复述自己的理解再回答。'
      const first = uid(3)
      const second = uid(4)
      seedFinding(world.database, first, 'intent_correction', statement, 60, '2026-11-01T07:00:01.000Z')
      seedFinding(world.database, second, 'intent_correction', statement, 60, '2026-11-01T08:00:01.000Z')
      world.router.ingestRun(RUN, [{ id: first, kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T07:00:01.000Z' }])
      expect(() => world.router.ingestRun(RUN, [
        { id: second, kind: 'intent_correction', statement, confidence: 60, createdAt: '2026-11-01T08:00:01.000Z' }
      ])).not.toThrow()

      const routes = world.database.connection.prepare('SELECT finding_id, status FROM reflection_finding_routes ORDER BY finding_id').all() as Array<{ finding_id: string; status: string }>
      expect(routes).toEqual([{ finding_id: first, status: 'routed' }])
      const items = world.database.connection.prepare('SELECT finding_id FROM cognitive_pending_items').all() as Array<{ finding_id: string }>
      expect(items).toEqual([{ finding_id: first }])
      const archived = world.database.connection.prepare(
        "SELECT payload_json FROM event_journal WHERE event_type = 'reflection.finding_reobserved' AND json_extract(payload_json, '$.findingId') = ?"
      ).get(second) as { payload_json: string } | undefined
      expect(archived).toBeDefined()
      expect(JSON.parse(archived!.payload_json)).toMatchObject({
        findingId: second,
        existingFindingId: first,
        pendingItemId: expect.any(String)
      })

      const item = world.pending.listOpen()[0]!
      expect(world.pending.decide(item.id, 'accepted')).toMatchObject({ status: 'decided', itemStatus: 'done' })
      expect(world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(first)).toEqual({ status: 'consumed' })
    } finally {
      world.close()
    }
  })

  it('routes later findings when one finding cannot be routed, and records the failure', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const broken = uid(5)
      const healthy = uid(6)
      seedFinding(world.database, broken, 'open_question', '坏路由。', 50, '2026-11-01T07:00:01.000Z')
      seedFinding(world.database, healthy, 'memory_gap', '健康路由。', 50, '2026-11-01T07:00:02.000Z')
      // A pre-existing route with the wrong route kind makes this finding fail.
      world.database.connection.prepare(
        "INSERT INTO reflection_finding_routes(finding_id, route, status, reason, run_id, kind, created_at, updated_at) VALUES (?, 'context_hint', 'routed', 'foreign route', ?, 'open_question', ?, ?)"
      ).run(broken, RUN, '2026-11-01T07:00:01.000Z', '2026-11-01T07:00:01.000Z')

      expect(() => world.router.ingestRun(RUN, [
        { id: broken, kind: 'open_question', statement: '坏路由。', confidence: 50, createdAt: '2026-11-01T07:00:01.000Z' },
        { id: healthy, kind: 'memory_gap', statement: '健康路由。', confidence: 50, createdAt: '2026-11-01T07:00:02.000Z' }
      ])).toThrow(/REFLECTION_INGEST_FAILED/)

      const healthyRoute = world.database.connection.prepare('SELECT route FROM reflection_finding_routes WHERE finding_id = ?').get(healthy) as { route: string } | undefined
      expect(healthyRoute?.route).toBe('context_hint')
      const failure = world.database.connection.prepare(
        "SELECT COUNT(*) AS n FROM event_journal WHERE event_type = 'reflection.finding_ingest_failed' AND json_extract(payload_json, '$.findingId') = ?"
      ).get(broken) as { n: number }
      expect(failure.n).toBe(1)
    } finally {
      world.close()
    }
  })

  it('recovers a finding that was stored without a route, idempotently', () => {
    const world = openWorld()
    try {
      seedRun(world.database)
      const stranded = uid(7)
      seedFinding(world.database, stranded, 'memory_gap', '未路由的 finding。', 50, '2026-11-01T07:00:01.000Z')
      expect(world.router.recoverUnrouted()).toEqual({ repaired: 1, failed: 0 })
      expect(world.database.connection.prepare('SELECT status FROM reflection_finding_routes WHERE finding_id = ?').get(stranded)).toEqual({ status: 'routed' })
      expect(world.router.recoverUnrouted()).toEqual({ repaired: 0, failed: 0 })
    } finally {
      world.close()
    }
  })

})

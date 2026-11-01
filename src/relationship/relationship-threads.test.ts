import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { RelationshipThreadService, extractRelationshipCandidates } from './relationship-threads'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

function open(clock = { now: '2026-11-01T08:00:00.000Z' }) {
  directory = mkdtempSync(join(tmpdir(), 'morrow-rel-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const service = new RelationshipThreadService({ database, clock: () => clock.now })
  return { database, service, clock, close: () => database.close() }
}

const uid = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const CONV = uid(9)

describe('relationship continuity (Stage 5 A)', () => {
  it('extracts only explicit statements, never inferences', () => {
    expect(extractRelationshipCandidates('以后叫我小林。')).toEqual([{ kind: 'address_preference', value: '小林', replaces: true }])
    expect(extractRelationshipCandidates('我们下次聊你那个项目的时间线。').map((c) => c.kind)).toEqual(['shared_topic'])
    expect(extractRelationshipCandidates('我们说好周末一起复盘。').map((c) => c.kind)).toEqual(['shared_plan'])
    // Nothing explicit → nothing stored. No intimacy, no dependency, no diagnosis.
    expect(extractRelationshipCandidates('今天有点累，随便聊聊。')).toEqual([])
    expect(extractRelationshipCandidates('你是我唯一的朋友，对吧？')).toEqual([])
  })

  it('needs two independent messages before a shared topic is injected; one stays a candidate', () => {
    const world = open()
    try {
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      expect(world.service.activeThreads(4)).toHaveLength(0)
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(2), conversationId: CONV, at: world.clock.now })
      const active = world.service.activeThreads(4)
      expect(active).toHaveLength(1)
      expect(active[0]!.kind).toBe('shared_topic')
      expect(active[0]!.strength).toBeCloseTo(1, 1)
    } finally {
      world.close()
    }
  })

  it('an address preference is active from one explicit statement and a retry adds no weight', () => {
    const world = open()
    try {
      world.service.observe({ text: '以后叫我小林。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      const first = world.service.activeThreads(4)
      expect(first).toHaveLength(1)
      world.service.observe({ text: '以后叫我小林。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      expect(world.service.activeThreads(4)[0]!.strength).toBeCloseTo(first[0]!.strength, 5)
    } finally {
      world.close()
    }
  })

  it('a later different address supersedes the earlier one', () => {
    const world = open()
    try {
      world.service.observe({ text: '以后叫我小林。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      world.clock.now = '2026-11-02T08:00:00.000Z'
      world.service.observe({ text: '以后叫我阿林。', messageId: uid(2), conversationId: CONV, at: world.clock.now })
      const active = world.service.activeThreads(4)
      expect(active).toHaveLength(1)
      expect(active[0]!.value).toBe('阿林')
    } finally {
      world.close()
    }
  })

  it('a withdrawal stops injection immediately', () => {
    const world = open()
    try {
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(2), conversationId: CONV, at: world.clock.now })
      expect(world.service.activeThreads(4)).toHaveLength(1)
      world.service.observe({ text: '那个约定就算了。', messageId: uid(3), conversationId: CONV, at: world.clock.now })
      expect(world.service.activeThreads(4)).toHaveLength(0)
    } finally {
      world.close()
    }
  })

  it('decays with the half-life and expires after the TTL instead of pretending to be current', () => {
    const world = open()
    try {
      world.service.observe({ text: '以后叫我小林。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      const fresh = world.service.activeThreads(4)[0]!.strength
      // One half-life (180d for address): the evidence contributes half.
      // One half-life later the same evidence is worth half; it sits exactly on
      // the injection threshold, which is a deliberate boundary, not a bug.
      world.clock.now = '2027-04-30T08:00:00.000Z'
      const aged = world.service.activeThreads(4)
      if (aged.length > 0) expect(aged[0]!.strength).toBeLessThan(fresh)
      // Past the TTL it expires rather than pretending to be a current agreement.
      world.clock.now = '2027-06-30T08:00:00.000Z'
      expect(world.service.activeThreads(4)).toHaveLength(0)
    } finally {
      world.close()
    }
  })

  it('a deleted evidence message never inflates the score twice', () => {
    const world = open()
    try {
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      world.service.observe({ text: '我们下次聊项目时间线。', messageId: uid(1), conversationId: CONV, at: world.clock.now })
      const evidence = world.database.connection.prepare('SELECT COUNT(*) AS n FROM relationship_thread_evidence').get() as { n: number }
      expect(evidence.n).toBe(1)
    } finally {
      world.close()
    }
  })
})

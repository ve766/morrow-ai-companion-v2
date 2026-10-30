import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import type { InterestRecord } from './self-model-domain'
import {
  EXPLORATION_COOLDOWN_HOURS,
  EXPLORATION_MAX_PER_DAY,
  ExplorationService,
  decideExploration,
  describeExploration
} from './exploration-policy'

let directory = ''
let database: SqliteDatabase | undefined
afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function openDatabase(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-exploration-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return database
}

function interest(overrides: Partial<InterestRecord> = {}): InterestRecord {
  const at = '2026-10-29T00:00:00.000Z'
  return {
    id: randomUUID(),
    label: '神经科学',
    status: 'active',
    evidenceCount: 5,
    conversationCount: 3,
    strength: 0.8,
    confidence: 80,
    sourceMessageId: randomUUID(),
    conversationId: randomUUID(),
    firstSeenAt: at,
    lastSeenAt: at,
    updatedAt: at,
    terms: ['神经', '科学'],
    ...overrides
  }
}

const NOW = '2026-10-30T12:00:00.000Z'

describe('exploration gate', () => {
  it('stays quiet when there is no candidate at all', () => {
    const decision = decideExploration({ interests: [], now: NOW, lastRaisedAt: null, raisedLastDay: 0, turn: null })
    expect(decision).toMatchObject({ allowed: false, reason: 'no_candidate' })
  })

  it('stays quiet when evidence is too thin', () => {
    const decision = decideExploration({
      interests: [interest({ evidenceCount: 2 })],
      now: NOW,
      lastRaisedAt: null,
      raisedLastDay: 0,
      turn: null
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'insufficient_evidence' })
  })

  it('stays quiet while the cooldown is running', () => {
    const lastRaisedAt = new Date(Date.parse(NOW) - (EXPLORATION_COOLDOWN_HOURS - 1) * 3_600_000).toISOString()
    const decision = decideExploration({ interests: [interest()], now: NOW, lastRaisedAt, raisedLastDay: 1, turn: null })
    expect(decision).toMatchObject({ allowed: false, reason: 'cooldown' })
  })

  it('stays quiet once the daily cap is reached', () => {
    const decision = decideExploration({
      interests: [interest()],
      now: NOW,
      lastRaisedAt: '2026-10-29T20:00:00.000Z',
      raisedLastDay: EXPLORATION_MAX_PER_DAY,
      turn: null
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'daily_cap' })
  })

  it('never raises a topic in a turn that corrects the assistant', () => {
    const decision = decideExploration({
      interests: [interest()],
      now: NOW,
      lastRaisedAt: null,
      raisedLastDay: 0,
      turn: { intent: 'correction', uncertainty: 'low', correction: true }
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'turn_not_suitable' })
  })

  it('never raises a topic when the intent reading is uncertain', () => {
    const decision = decideExploration({
      interests: [interest()],
      now: NOW,
      lastRaisedAt: null,
      raisedLastDay: 0,
      turn: { intent: 'sharing', uncertainty: 'high', correction: false }
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'turn_not_suitable' })
  })

  it('allows exactly one topic and picks the strongest', () => {
    const weak = interest({ strength: 0.7, label: '航海史' })
    const strong = interest({ strength: 0.9, label: '分布式系统' })
    const decision = decideExploration({ interests: [weak, strong], now: NOW, lastRaisedAt: null, raisedLastDay: 0, turn: null })
    expect(decision.allowed).toBe(true)
    expect(decision.label).toBe('分布式系统')
    expect(decision.interestId).toBe(strong.id)
    expect(describeExploration(decision)).toContain('分布式系统')
    expect(describeExploration(decision)).toContain('your own attention')
  })

  it('does not repeat a topic it already raised', () => {
    const used = interest()
    const decision = decideExploration({
      interests: [used],
      now: NOW,
      lastRaisedAt: '2026-10-01T00:00:00.000Z',
      raisedLastDay: 0,
      turn: null,
      recentlyUsed: [used.id]
    })
    expect(decision).toMatchObject({ allowed: false, reason: 'already_used' })
  })
})

describe('ExplorationService', () => {
  it('records the raise and then enforces its own cooldown', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const turnId = randomUUID()

    const first = service.decide({ turnId, interests: [candidate], turn: null })
    expect(first.allowed).toBe(true)

    const second = service.decide({ turnId: randomUUID(), interests: [candidate], turn: null })
    expect(second.allowed).toBe(false)
    expect(['cooldown', 'already_used']).toContain(second.reason)
  })

  it('re-deciding the same turn is stable (the preview and the verified payload agree)', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const turnId = randomUUID()
    const first = service.decide({ turnId, interests: [candidate], turn: null })
    const second = service.decide({ turnId, interests: [candidate], turn: null })
    expect(second).toEqual(first)
  })

  it('records nothing when no topic was even eligible', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ evidenceCount: 1 })
    service.decide({ turnId: randomUUID(), interests: [candidate], turn: null })
    const rows = database.connection.prepare('SELECT kind FROM exploration_events').all() as Array<{ kind: string }>
    expect(rows).toHaveLength(0)
    expect(service.recent().raisedLastDay).toBe(0)
  })
})

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
    origin: 'morrow',
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

  it('never raises a topic when the user asked for a direct answer', () => {
    const decision = decideExploration({
      interests: [interest()],
      now: NOW,
      lastRaisedAt: null,
      raisedLastDay: 0,
      turn: { intent: 'information_query', uncertainty: 'low', correction: false, directRequest: true }
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
  it('records permission but does not count it as a raise', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const turnId = randomUUID()

    const decision = service.decide({ turnId, interests: [candidate], turn: null })
    expect(decision.allowed).toBe(true)
    expect(service.history(turnId).map((entry) => entry.state)).toContain('permitted')
    expect(service.recent().raisedLastDay).toBe(0)
  })

  it('counts a raise only after a persisted reply mentions the topic', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ label: '神经科学' })
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    const settled = service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '我最近也在想神经科学里记忆形成的问题。' })
    expect(settled).toBe('actually_raised')
    expect(service.recent().raisedLastDay).toBe(1)
  })

  it('does not count a reply that never mentions the topic', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ label: '神经科学' })
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    // '好的。' is too short to judge, so the honest answer is `uncertain`, not a
    // confident "did not raise". It still must not consume the budget.
    expect(service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '好的。' })).toBe('uncertain')
    expect(service.recent().raisedLastDay).toBe(0)
    expect(service.usedToday()).toBe(0)
  })

  it('distinguishes a reply that clearly ignores the topic', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ label: '神经科学' })
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    expect(service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '我们换个话题吧，聊聊今天的天气怎么样。' })).toBe('not_raised')
    expect(service.usedToday()).toBe(0)
  })

  it('never counts a failed or cancelled turn as a raise', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const failed = randomUUID()
    service.decide({ turnId: failed, interests: [candidate], turn: null })
    expect(service.settle({ turnId: failed, interestId: candidate.id, label: candidate.label, outcome: 'failed', reply: null })).toBe('provider_failed')
    expect(service.recent().raisedLastDay).toBe(0)
  })

  it('is idempotent: settling the same turn twice counts once', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ label: '神经科学' })
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '我最近一直在想神经科学的问题。' })
    service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '我最近一直在想神经科学的问题。' })
    expect(service.recent().raisedLastDay).toBe(1)
    expect(service.history(turnId).filter((entry) => entry.state === 'actually_raised')).toHaveLength(1)
  })

  it('re-deciding the same turn is stable (the preview and the verified payload agree)', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const turnId = randomUUID()
    const first = service.decide({ turnId, interests: [candidate], turn: null })
    const second = service.decide({ turnId, interests: [candidate], turn: null })
    expect(second).toEqual(first)
    expect(service.history(turnId).filter((entry) => entry.state === 'permitted')).toHaveLength(1)
  })

  it('reserves atomically and refuses the third raise of the day', () => {
    const database = openDatabase()
    let now = '2026-10-30T09:00:00.000Z'
    const service = new ExplorationService(database, () => now)
    const candidates = [interest({ label: '神经科学' }), interest({ label: '分布式系统' }), interest({ label: '航海史' })]
    const outcomes: string[] = []
    for (const candidate of candidates) {
      const turnId = randomUUID()
      const decision = service.decide({ turnId, interests: [candidate], turn: null })
      if (!decision.allowed) { outcomes.push('denied'); continue }
      service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: `我最近一直在想${candidate.label}的问题。` })
      outcomes.push('raised')
      now = new Date(Date.parse(now) + 7 * 60 * 60 * 1000).toISOString()
    }
    expect(outcomes).toEqual(['raised', 'raised', 'denied'])
    expect(service.usedToday()).toBe(2)
  })

  it('releases the slot when the reply never mentions the topic', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ label: '神经科学' })
    const first = randomUUID()
    service.decide({ turnId: first, interests: [candidate], turn: null })
    expect(service.usedToday()).toBe(1)
    service.settle({ turnId: first, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: '好的。' })
    expect(service.usedToday()).toBe(0)
  })

  it('releases the slot when the provider fails', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest()
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'failed', reply: null })
    expect(service.usedToday()).toBe(0)
  })

  it('starts a fresh budget on the next day', () => {
    const database = openDatabase()
    let now = '2026-10-30T09:00:00.000Z'
    const service = new ExplorationService(database, () => now)
    const first = interest({ label: '神经科学' })
    const second = interest({ label: '分布式系统' })
    for (const candidate of [first, second]) {
      const turnId = randomUUID()
      service.decide({ turnId, interests: [candidate], turn: null })
      service.settle({ turnId, interestId: candidate.id, label: candidate.label, outcome: 'succeeded', reply: `我还是想弄明白${candidate.label}。` })
      now = new Date(Date.parse(now) + 7 * 60 * 60 * 1000).toISOString()
    }
    expect(service.usedToday()).toBe(2)
    // Two limits are enforced at once: the calendar-day budget and a rolling
    // 24-hour window. Move far enough that the rolling window has also cleared,
    // otherwise this would test the wrong one.
    now = '2026-10-31T20:00:00.000Z'
    expect(service.usedToday()).toBe(0)
    // A third topic: the first two were already raised and are legitimately
    // skipped as repeats, which would mask the budget reset.
    const third = interest({ label: '航海史' })
    const next = randomUUID()
    expect(service.decide({ turnId: next, interests: [third], turn: null }).allowed).toBe(true)
  })

  it('records nothing when no topic was even eligible', () => {
    const database = openDatabase()
    const service = new ExplorationService(database, () => NOW)
    const candidate = interest({ evidenceCount: 1 })
    const turnId = randomUUID()
    service.decide({ turnId, interests: [candidate], turn: null })
    expect(service.history(turnId)).toHaveLength(0)
    expect(service.recent().raisedLastDay).toBe(0)
  })
})

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import type { CognitiveTurnAnalysis } from '../cognition/cognition'
import {
  GROWTH_HALF_LIFE_DAYS,
  GROWTH_MAX_OFFSET,
  GROWTH_MIN_EVIDENCE,
  GROWTH_STEP,
  PersonalityGrowthService,
  applyGrowth,
  deriveGrowthSignals,
  describeGrowth,
  foldGrowth,
  growthDecay
} from './personality-growth'

let directory = ''
let database: SqliteDatabase | undefined
afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function openDatabase(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-growth-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return database
}

function row(signal: number, weight: number, at: string) {
  return { dimension: 'warmth', turn_id: randomUUID(), signal, weight, created_at: at }
}

function analysis(overrides: Partial<CognitiveTurnAnalysis['signals']> = {}, confidenceScore = 80): CognitiveTurnAnalysis {
  // Only the fields `deriveGrowthSignals` reads are meaningful here; the rest of
  // the envelope is filled so the object is a faithful `CognitiveTurnAnalysis`.
  return {
    schemaVersion: 1,
    analyzerVersion: 'rules-v2',
    intent: 'sharing',
    alternatives: [],
    confidenceScore,
    confidenceBasis: 'unvalidated_rule_strength',
    uncertainty: 'low',
    strategy: 'answer',
    topicSource: 'current',
    topicReferenceMessageId: null,
    signals: {
      correction: false,
      negation: false,
      changedMind: false,
      explicitGoal: false,
      explicitConstraint: false,
      explicitMemoryRequest: false,
      explicitMemorySaveRequest: false,
      explicitSelfFact: false,
      topicSwitch: false,
      ...overrides
    },
    evidence: {
      schemaVersion: 1,
      recordKind: 'intent',
      recordId: randomUUID(),
      source: 'local_rules',
      status: 'observation',
      evidenceRefs: [],
      confidenceScore: null
    }
  } as unknown as CognitiveTurnAnalysis
}

describe('growth decay and fold', () => {
  it('halves the contribution after one half-life', () => {
    expect(growthDecay(0)).toBe(1)
    expect(growthDecay(GROWTH_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 6)
    expect(growthDecay(GROWTH_HALF_LIFE_DAYS * 2)).toBeCloseTo(0.25, 6)
  })

  it('moves nothing below the evidence gate', () => {
    const now = '2026-10-30T00:00:00.000Z'
    const folded = foldGrowth([row(1, 1, now), row(1, 1, now)], now)
    expect(folded.applied).toBe(false)
    expect(folded.offset).toBe(0)
    expect(folded.evidenceCount).toBe(2)
  })

  it('applies at the gate and caps one signal at a single step', () => {
    const now = '2026-10-30T00:00:00.000Z'
    const folded = foldGrowth([row(1, 1, now), row(1, 1, now), row(1, 1, now)], now)
    expect(folded.applied).toBe(true)
    // Three signals, each capped at GROWTH_STEP.
    expect(folded.offset).toBeCloseTo(GROWTH_STEP * 3, 4)
  })

  it('never exceeds the hard offset cap no matter how much evidence arrives', () => {
    const now = '2026-10-30T00:00:00.000Z'
    const rows = Array.from({ length: 200 }, () => row(1, 1, now))
    expect(foldGrowth(rows, now).offset).toBe(GROWTH_MAX_OFFSET)
  })

  it('discounts old evidence instead of dropping the row', () => {
    const now = '2026-10-30T00:00:00.000Z'
    const fresh = foldGrowth([row(1, 1, now), row(1, 1, now), row(1, 1, now)], now)
    const stale = foldGrowth(
      [
        row(1, 1, '2026-08-01T00:00:00.000Z'),
        row(1, 1, '2026-08-01T00:00:00.000Z'),
        row(1, 1, now)
      ],
      now
    )
    expect(stale.evidenceCount).toBe(3)
    expect(stale.offset).toBeLessThan(fresh.offset)
    expect(stale.offset).toBeGreaterThan(0)
  })
})

describe('effective personality', () => {
  it('adds the drift to the baseline and clamps to the 0-100 scale', () => {
    const effective = applyGrowth(
      { warmth: 99, directness: 1, humor: 50 },
      [
        { dimension: 'warmth', offset: 8, evidenceCount: 9, applied: true, revision: 1, updatedAt: '', lastTurnId: null },
        { dimension: 'directness', offset: -8, evidenceCount: 9, applied: true, revision: 1, updatedAt: '', lastTurnId: null }
      ]
    )
    expect(effective.warmth).toBe(100)
    expect(effective.directness).toBe(0)
    expect(effective.humor).toBe(50)
    expect(effective.offsets).toEqual({ warmth: 8, directness: -8 })
  })

  it('describes only dimensions that actually moved', () => {
    expect(describeGrowth([])).toBe('')
    const line = describeGrowth([
      { dimension: 'warmth', offset: 2.5, evidenceCount: 7, applied: true, revision: 2, updatedAt: '', lastTurnId: null },
      { dimension: 'humor', offset: 0, evidenceCount: 1, applied: false, revision: 0, updatedAt: '', lastTurnId: null }
    ])
    expect(line).toContain('warmth +2.50')
    expect(line).not.toContain('humor')
    expect(line).toContain('reversible')
  })
})

describe('growth evidence derivation', () => {
  it('derives nothing without an analysis or without the user text', () => {
    expect(deriveGrowthSignals({ analysis: undefined })).toEqual([])
    expect(deriveGrowthSignals({ analysis: analysis(), content: '' })).toEqual([])
  })

  it('reads an explicit style directive as evidence for that dimension only', () => {
    const signals = deriveGrowthSignals({ analysis: analysis(), content: '以后直接说重点，别铺垫。' })
    expect(signals).toHaveLength(1)
    expect(signals[0]!.dimension).toBe('directness')
    expect(signals[0]!.signal).toBeGreaterThan(0)
    expect(signals[0]!.source).toBe('explicit_direct_request')
  })

  it('records the opposite directive as counter-evidence, not as support', () => {
    const signals = deriveGrowthSignals({ analysis: analysis(), content: '你能不能委婉一点，别这么直接。' })
    expect(signals[0]!.dimension).toBe('directness')
    expect(signals[0]!.signal).toBeLessThan(0)
    expect(signals[0]!.source).toBe('explicit_soft_request')
  })

  it('aggregates contradictory evidence in one turn instead of keeping the first match', () => {
    const signals = deriveGrowthSignals({ analysis: analysis(), content: '直接说重点，但也别太冲。' })
    const directness = signals.find((signal) => signal.dimension === 'directness')
    // +0.8 and −0.8 cancel: the turn is not a preference in either direction.
    expect(directness).toBeUndefined()
  })

  it('keeps a partial net when the two directions differ in strength', () => {
    const signals = deriveGrowthSignals({ analysis: analysis(), content: '说话委婉一点，但重要的地方直接说重点。' })
    const directness = signals.find((signal) => signal.dimension === 'directness')
    expect(directness?.signal ?? 0).toBe(0)
  })

  it('abstains below the confidence floor', () => {
    expect(deriveGrowthSignals({ analysis: analysis({}, 40), content: '直接说吧。' })).toEqual([])
  })

  it('abstains on an unreadable turn', () => {
    const uncertain = analysis()
    uncertain.intent = 'uncertain'
    expect(deriveGrowthSignals({ analysis: uncertain, content: '直接说吧。' })).toEqual([])
  })

  it('abstains on a hypothesis or a role play', () => {
    expect(deriveGrowthSignals({ analysis: analysis(), content: '如果你是朋友，你会不会直接说重点？' })).toEqual([])
    expect(deriveGrowthSignals({ analysis: analysis(), content: '假装你是我的教练，严肃点批评我。' })).toEqual([])
  })

  it('does not treat a correction or a memory request as a personality signal', () => {
    const corrected = deriveGrowthSignals({ analysis: analysis({ correction: true }), content: '不是这个意思，你理解错了。' })
    const remembered = deriveGrowthSignals({ analysis: analysis({ explicitMemoryRequest: true }), content: '你还记得我住在哪吗？' })
    expect(corrected).toEqual([])
    expect(remembered).toEqual([])
  })

  it('ignores a directive that is quoted rather than stated', () => {
    expect(deriveGrowthSignals({ analysis: analysis(), content: '他说「直接说重点」，你觉得呢？' })).toEqual([])
  })

  it('emits at most one net signal per dimension per turn', () => {
    const signals = deriveGrowthSignals({ analysis: analysis(), content: '直接说重点，也别绕，开门见山。' })
    expect(signals.filter((signal) => signal.dimension === 'directness')).toHaveLength(1)
  })
})

describe('PersonalityGrowthService', () => {
  it('withholds, then applies once the evidence gate is reached', () => {
    const database = openDatabase()
    const clock = () => '2026-10-30T00:00:00.000Z'
    const service = new PersonalityGrowthService(database, clock)

    const first = service.apply({ dimension: 'warmth', signal: 0.5, weight: 0.5, turnId: randomUUID(), at: clock() })
    expect(first.applied).toBe(false)
    expect(first.offset).toBe(0)
    expect(first.evidenceCount).toBe(1)

    service.apply({ dimension: 'warmth', signal: 0.5, weight: 0.5, turnId: randomUUID(), at: clock() })
    const third = service.apply({ dimension: 'warmth', signal: 0.5, weight: 0.5, turnId: randomUUID(), at: clock() })
    expect(third.applied).toBe(true)
    expect(third.offset).toBeGreaterThan(0)
    expect(third.offset).toBeLessThanOrEqual(GROWTH_MAX_OFFSET)

    const history = service.history('warmth')
    expect(history.some((entry) => entry.kind === 'withheld')).toBe(true)
    expect(history[0]!.kind).toBe('applied')
  })

  it('is idempotent for a replayed turn', () => {
    const database = openDatabase()
    const clock = () => '2026-10-30T00:00:00.000Z'
    const service = new PersonalityGrowthService(database, clock)
    const turnId = randomUUID()
    service.apply({ dimension: 'directness', signal: 0.6, weight: 0.5, turnId, at: clock() })
    const again = service.apply({ dimension: 'directness', signal: 0.6, weight: 0.5, turnId, at: clock() })
    expect(again.evidenceCount).toBe(1)
  })

  it('drops a deleted turn back out of the fold', () => {
    const database = openDatabase()
    const clock = () => '2026-10-30T00:00:00.000Z'
    const service = new PersonalityGrowthService(database, clock)
    const turns = [randomUUID(), randomUUID(), randomUUID()]
    for (const turnId of turns) service.apply({ dimension: 'humor', signal: 1, weight: 1, turnId, at: clock() })
    const before = service.get('humor')
    expect(before.applied).toBe(true)

    const after = service.forgetTurn(turns[0]!)
    const humor = after.find((entry) => entry.dimension === 'humor')!
    expect(humor.evidenceCount).toBe(2)
    expect(humor.offset).toBe(0)
    expect(humor.applied).toBe(false)
  })

  it('rolls back to zero and records the rollback', () => {
    const database = openDatabase()
    const clock = () => '2026-10-30T00:00:00.000Z'
    const service = new PersonalityGrowthService(database, clock)
    for (let index = 0; index < GROWTH_MIN_EVIDENCE; index += 1) {
      service.apply({ dimension: 'warmth', signal: 1, weight: 1, turnId: randomUUID(), at: clock() })
    }
    expect(service.get('warmth').offset).toBeGreaterThan(0)

    const rolled = service.rollback('warmth')
    expect(rolled.offset).toBe(0)
    expect(rolled.evidenceCount).toBe(0)
    expect(service.history('warmth')[0]!.kind).toBe('rolled_back')
  })

  it('rejects malformed evidence instead of storing it', () => {
    const database = openDatabase()
    const service = new PersonalityGrowthService(database)
    expect(() => service.apply({ dimension: 'warmth', signal: 1, weight: 1, turnId: 'not-a-uuid', at: '2026-10-30T00:00:00.000Z' })).toThrow()
    expect(() => service.apply({ dimension: 'warmth', signal: Number.NaN, weight: 1, turnId: randomUUID(), at: '2026-10-30T00:00:00.000Z' })).toThrow()
  })
})

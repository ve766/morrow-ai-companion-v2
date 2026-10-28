import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_PENDING_ITEMS_PER_TURN,
  PendingCognitionService,
  derivePendingItems,
  pendingItemFromReflection,
  runBounded
} from './pending-items'
import { SqlitePendingItemRepository } from '../persistence/cognitive-context-repository'
import { SqliteDatabase } from '../persistence/database'

const directories: string[] = []

function openDatabase(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-pending-'))
  directories.push(directory)
  return SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
}

const conversationId = '11111111-1111-4111-8111-111111111111'
const turnA = '22222222-2222-4222-8222-222222222222'
const turnB = '33333333-3333-4333-8333-333333333333'

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('pending item derivation', () => {
  it('turns each conflict group into one item, keyed by the group rather than the turn', () => {
    const first = derivePendingItems({
      turnId: turnA,
      conversationId,
      at: '2026-01-01T00:00:00.000Z',
      status: 'succeeded',
      conflicts: [{ predicate: 'residence', memoryIds: ['b', 'a'] }],
      blockedClaimKinds: []
    }, randomUUID)
    const second = derivePendingItems({
      turnId: turnB,
      conversationId,
      at: '2026-01-02T00:00:00.000Z',
      status: 'succeeded',
      conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }],
      blockedClaimKinds: []
    }, randomUUID)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    // Same concern observed on a later turn: same key, so the store dedupes.
    expect(second[0]!.dedupeKey).toBe(first[0]!.dedupeKey)
    // The ids are normalised, so ordering cannot fork the key.
    expect(first[0]!.dedupeKey).toContain('a,b')
  })

  it('does not derive anything from a failed or cancelled turn', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      expect(derivePendingItems({
        turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status,
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: ['phone']
      }, randomUUID)).toEqual([])
    }
  })

  it('records a blocked claim kind as an evidence gap, without the value', () => {
    const drafts = derivePendingItems({
      turnId: turnA,
      conversationId,
      at: '2026-01-01T00:00:00.000Z',
      status: 'succeeded',
      conflicts: [],
      blockedClaimKinds: ['vehicle_plate', 'vehicle_plate']
    }, randomUUID)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.source).toBe('evidence_gap')
    expect(drafts[0]!.dedupeKey).toBe('evidence_gap:vehicle_plate')
    expect(JSON.stringify(drafts[0]!.detail)).not.toMatch(/京|沪|[A-Z]{2}\d/u)
  })

  it('ignores a conflict group that does not have two distinct records', () => {
    expect(derivePendingItems({
      turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded',
      conflicts: [{ predicate: 'residence', memoryIds: ['a', 'a'] }], blockedClaimKinds: []
    }, randomUUID)).toEqual([])
  })

  it('bounds the number of items a single turn can create', () => {
    const conflicts = Array.from({ length: 20 }, (_, index) => ({ predicate: 'p', memoryIds: [`a${index}`, `b${index}`] }))
    const drafts = derivePendingItems({
      turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded', conflicts, blockedClaimKinds: []
    }, randomUUID)
    expect(drafts.length).toBeLessThanOrEqual(MAX_PENDING_ITEMS_PER_TURN)
  })

  it('derives a reflection item that stores a digest instead of the statement twice', () => {
    const draft = pendingItemFromReflection({
      runId: turnA,
      kind: 'memory_gap',
      statement: '存在 1 条被撤销的记忆；不要把它们当作当前事实引用。',
      confidence: 65,
      at: '2026-01-01T00:00:00.000Z',
      makeId: randomUUID
    })
    expect(draft.source).toBe('reflection')
    expect(draft.dedupeKey.startsWith('reflection:memory_gap:')).toBe(true)
    expect(String(draft.detail.statementDigest)).toMatch(/^[0-9a-f]{16}$/u)
  })
})

describe('pending item store', () => {
  it('dedupes by concern, keeps the first id, and raises priority', () => {
    const database = openDatabase()
    try {
      const service = new PendingCognitionService(new SqlitePendingItemRepository(database))
      const idsA = service.observeTurn({
        turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
      })
      const idsB = service.observeTurn({
        turnId: turnB, conversationId, at: '2026-01-02T00:00:00.000Z', status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
      })
      expect(idsB).toEqual(idsA)
      const open = service.listOpen()
      expect(open).toHaveLength(1)
      expect(open[0]!.createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(open[0]!.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    } finally {
      database.close()
    }
  })

  it('keeps a completed item completed when the same concern is observed again', () => {
    const database = openDatabase()
    try {
      const service = new PendingCognitionService(new SqlitePendingItemRepository(database))
      const [id] = service.observeTurn({
        turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
      })
      expect(service.complete(id!)).toBe(true)
      expect(service.listOpen()).toHaveLength(0)

      service.observeTurn({
        turnId: turnB, conversationId, at: '2026-01-02T00:00:00.000Z', status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
      })
      // The resolved concern must not come back on the next turn.
      expect(service.listOpen()).toHaveLength(0)
      expect(service.get(id!)?.status).toBe('done')
    } finally {
      database.close()
    }
  })

  it('completing twice is not an error, and completing an unknown id is false', () => {
    const database = openDatabase()
    try {
      const service = new PendingCognitionService(new SqlitePendingItemRepository(database))
      const [id] = service.observeTurn({
        turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded',
        conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
      })
      expect(service.complete(id!)).toBe(true)
      expect(service.complete(id!)).toBe(true)
      expect(service.complete('99999999-9999-4999-8999-999999999999')).toBe(false)
    } finally {
      database.close()
    }
  })

  it('absorbs the same reflection findings once, however many runs report them', () => {
    const database = openDatabase()
    try {
      const service = new PendingCognitionService(new SqlitePendingItemRepository(database))
      const findings = [{ kind: 'memory_gap', statement: '存在 2 条被撤销的记忆。', confidence: 65 }]
      const first = service.absorbReflection({ runId: turnA, findings })
      const second = service.absorbReflection({ runId: turnB, findings })
      expect(second).toEqual(first)
      expect(service.listOpen()).toHaveLength(1)
      expect(service.listOpen()[0]!.source).toBe('reflection')
    } finally {
      database.close()
    }
  })

  it('survives being reopened from disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-pending-restart-'))
    directories.push(directory)
    const path = join(directory, 'morrow.sqlite3')
    const first = SqliteDatabase.open(path)
    const [id] = new PendingCognitionService(new SqlitePendingItemRepository(first)).observeTurn({
      turnId: turnA, conversationId, at: '2026-01-01T00:00:00.000Z', status: 'succeeded',
      conflicts: [{ predicate: 'residence', memoryIds: ['a', 'b'] }], blockedClaimKinds: []
    })
    first.close()

    const second = SqliteDatabase.open(path)
    try {
      const reopened = new PendingCognitionService(new SqlitePendingItemRepository(second))
      expect(reopened.listOpen().map((item) => item.id)).toEqual([id])
    } finally {
      second.close()
    }
  })
})

describe('bounded internal activity', () => {
  it('runs an operation that finishes inside the budget', async () => {
    const result = await runBounded(async () => 'ok', { budgetMs: 1_000 })
    expect(result).toEqual({ status: 'completed', value: 'ok' })
  })

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runBounded(async () => 'never', { signal: controller.signal, budgetMs: 1_000 })
    expect(result.status).toBe('cancelled')
  })

  it('reports an exhausted budget instead of running anyway', async () => {
    const startedAtMs = Date.now() - 5_000
    const result = await runBounded(async () => 'never', { budgetMs: 1_000, startedAtMs })
    expect(result).toEqual({ status: 'skipped', reason: 'budget_exhausted' })
  })

  it('returns a failure instead of throwing into the caller', async () => {
    const result = await runBounded(async () => { throw new Error('boom') }, { budgetMs: 1_000 })
    expect(result.status).toBe('failed')
  })

  it('cancels an operation that outlives the budget', async () => {
    const result = await runBounded(
      (signal) => new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('late'), 5_000)
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve('aborted') }, { once: true })
      }),
      { budgetMs: 20 }
    )
    expect(result.status).toBe('cancelled')
  })
})

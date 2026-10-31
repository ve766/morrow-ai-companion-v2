import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { UserInteractionProfileService } from './interaction-profile'

let directory = ''
let database: SqliteDatabase | undefined

afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

const NOW = '2026-10-31T00:00:00.000Z'

function build(baseline = { warmth: 60, directness: 50, humor: 40 }): { db: SqliteDatabase; service: UserInteractionProfileService } {
  directory = mkdtempSync(join(tmpdir(), 'morrow-interaction-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return { db: database, service: new UserInteractionProfileService(database, () => baseline, () => NOW) }
}

describe('UserInteractionProfileService', () => {
  it('starts neutral and seeds from the identity baseline', () => {
    const { service } = build()
    const entries = service.list()
    expect(entries.map((entry) => entry.dimension).sort()).toEqual(['directness', 'humor', 'warmth'])
    expect(entries.every((entry) => entry.offset === 0)).toBe(true)
    expect(entries.find((entry) => entry.dimension === 'warmth')!.baseline).toBe(60)
  })

  it('does not move below the evidence gate', () => {
    const { service } = build()
    service.apply({ dimension: 'directness', signal: 0.8, weight: 0.8, source: 'explicit_direct_request', turnId: randomUUID(), at: NOW })
    service.apply({ dimension: 'directness', signal: 0.8, weight: 0.8, source: 'explicit_direct_request', turnId: randomUUID(), at: NOW })
    expect(service.offsets().directness).toBe(0)
  })

  it('moves after three independent turns and stays bounded', () => {
    const { service } = build()
    for (let index = 0; index < 6; index += 1) {
      service.apply({ dimension: 'directness', signal: 1, weight: 1, source: 'explicit_direct_request', turnId: randomUUID(), at: NOW })
    }
    const offset = service.offsets().directness
    expect(offset).toBeGreaterThan(0)
    expect(Math.abs(offset)).toBeLessThanOrEqual(8)
  })

  it('counts a replayed turn once', () => {
    const { service } = build()
    const turnId = randomUUID()
    for (let index = 0; index < 5; index += 1) {
      service.apply({ dimension: 'warmth', signal: 1, weight: 1, source: 'explicit_warmth_request', turnId, at: NOW })
    }
    const entry = service.list().find((candidate) => candidate.dimension === 'warmth')!
    expect(entry.evidenceCount).toBe(1)
    expect(entry.offset).toBe(0)
  })

  it('rolls back without touching the identity baseline', () => {
    const { db, service } = build()
    for (let index = 0; index < 4; index += 1) {
      service.apply({ dimension: 'humor', signal: 1, weight: 1, source: 'explicit_humor_request', turnId: randomUUID(), at: NOW })
    }
    expect(service.offsets().humor).toBeGreaterThan(0)

    service.rollback('humor')

    expect(service.offsets().humor).toBe(0)
    // The identity row is a different table and was never written by this service.
    const identityRows = db.connection.prepare('SELECT COUNT(*) AS n FROM personality_profiles').get() as { n: number }
    expect(Number(identityRows.n)).toBe(0)
  })

  it('describes only dimensions that actually moved', () => {
    const { service } = build()
    expect(service.describe()).toBe('')
    for (let index = 0; index < 4; index += 1) {
      service.apply({ dimension: 'directness', signal: 1, weight: 1, source: 'explicit_direct_request', turnId: randomUUID(), at: NOW })
    }
    const line = service.describe()
    expect(line).toContain('directness')
    expect(line).toContain('does not change Morrow')
  })
})

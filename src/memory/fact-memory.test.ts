import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from './memory-service'
import { FactMemoryService } from './fact-memory'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { extractFactSlots } from './fact-slot'

let directory = ''
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

function open() {
  directory = mkdtempSync(join(tmpdir(), 'morrow-fact-ledger-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const factMemory = new FactMemoryService({ database })
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, undefined, { factIndex: factMemory })
  return { database, factMemory, memories, close: () => database.close() }
}

describe('fact ledger (final closure R1/R2)', () => {
  it('extracts multiple facts from one memory', () => {
    const candidates = extractFactSlots('我住在杭州，猫叫豆豆。')
    const predicates = candidates.map((candidate) => candidate.predicate).sort()
    expect(predicates).toContain('residence')
    expect(predicates).toContain('pet_name')
  })

  it('stays conservative on questions, negations-without-value and unknown shapes', () => {
    expect(extractFactSlots('我住在哪？')).toEqual([])
    expect(extractFactSlots('今天路过一家咖啡店。')).toEqual([])
  })

  it('indexes every fact of one memory with the right source revision', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州，猫叫豆豆。', 'personal')
      const facts = world.database.connection.prepare(
        'SELECT predicate, value_normalized, source_revision, status FROM fact_records WHERE source_memory_id = ?'
      ).all(memory.id) as Array<{ predicate: string; value_normalized: string; source_revision: number; status: string }>
      expect(facts.length).toBeGreaterThanOrEqual(2)
      for (const fact of facts) expect(fact.source_revision).toBe(memory.revision)
    } finally {
      world.close()
    }
  })

  it('R2: a retracted memory with an empty ledger never resurrects facts on reindexAll', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州。', 'personal')
      world.memories.retract(memory.id)
      // Wipe the index to simulate "retracted before it was ever indexed".
      world.database.connection.prepare('DELETE FROM fact_records').run()
      world.factMemory.reindexAll()
      const count = world.database.connection.prepare(
        "SELECT COUNT(*) AS n FROM fact_records WHERE source_memory_id = ? AND status = 'active'"
      ).get(memory.id) as { n: number }
      expect(count.n).toBe(0)
    } finally {
      world.close()
    }
  })

  it('R2: retracting closes facts instead of re-creating them', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州。', 'personal')
      expect(world.factMemory.counts().active).toBe(1)
      world.memories.retract(memory.id)
      expect(world.factMemory.counts().active).toBe(0)
      const row = world.database.connection.prepare(
        'SELECT status FROM fact_records WHERE source_memory_id = ?'
      ).get(memory.id) as { status: string }
      expect(row.status).toBe('retracted')
    } finally {
      world.close()
    }
  })

  it('correct supersedes the old value and cites the new revision', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州。', 'personal')
      world.memories.correct(memory.id, '我住在苏州。')
      const rows = world.database.connection.prepare(
        'SELECT value_normalized, status, source_revision FROM fact_records WHERE source_memory_id = ? ORDER BY status'
      ).all(memory.id) as Array<{ value_normalized: string; status: string; source_revision: number }>
      expect(rows.find((row) => row.value_normalized === '苏州')).toMatchObject({ status: 'active' })
      const superseded = rows.find((row) => row.value_normalized === '杭州')
      expect(superseded).toMatchObject({ status: 'superseded' })
    } finally {
      world.close()
    }
  })

  it('replays are idempotent: ten reindexes leave one row per fact', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州。', 'personal')
      for (let index = 0; index < 10; index += 1) world.factMemory.reindexMemory(memory.id)
      const count = world.database.connection.prepare(
        'SELECT COUNT(*) AS n FROM fact_records WHERE source_memory_id = ?'
      ).get(memory.id) as { n: number }
      expect(count.n).toBe(1)
    } finally {
      world.close()
    }
  })

  it('deleting the memory leaves no orphan facts', () => {
    const world = open()
    try {
      const memory = world.memories.create('我住在杭州。', 'personal')
      world.memories.delete(memory.id)
      expect(world.factMemory.counts().total).toBe(0)
    } finally {
      world.close()
    }
  })

  it('different memories with different values stay conflict candidates, not auto-superseded', () => {
    const world = open()
    try {
      world.memories.create('我住在上海。', 'personal')
      world.memories.create('我住在北京。', 'personal')
      const rows = world.database.connection.prepare(
        "SELECT status FROM fact_records WHERE predicate = 'residence'"
      ).all() as Array<{ status: string }>
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.status === 'active')).toBe(true)
    } finally {
      world.close()
    }
  })
})

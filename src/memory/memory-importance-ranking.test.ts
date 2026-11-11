import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from './memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemoryImportanceService } from './memory-importance'

let directory = ''
let database: SqliteDatabase | undefined

afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function build(): { db: SqliteDatabase; importance: MemoryImportanceService; memories: MemoryService } {
  directory = mkdtempSync(join(tmpdir(), 'morrow-ranking-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const importance = new MemoryImportanceService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, undefined, { importance })
  return { db: database, importance, memories }
}

/** Forces a score so the test measures ranking, not the scoring formula. */
function setScore(db: SqliteDatabase, memoryId: string, score: number): void {
  db.connection.prepare(`
    INSERT INTO memory_importance(memory_id, score, components_json, version, computed_at)
    VALUES (?, ?, '{}', 'test', '2026-10-31T00:00:00.000Z')
    ON CONFLICT(memory_id) DO UPDATE SET score = excluded.score
  `).run(memoryId, score)
}

describe('importance in retrieval ranking', () => {
  it('changes the order of two equally relevant memories', () => {
    const { db, memories } = build()
    const first = memories.create('我住在杭州，平时喜欢喝茶。', 'personal')
    const second = memories.create('我住在杭州，周末常去爬山。', 'personal')

    setScore(db, first.id, 1)
    setScore(db, second.id, 0)
    const highFirst = memories.assembleContext('杭州', 'personal').selected.map((item) => item.id)
    expect(highFirst.indexOf(first.id)).toBeLessThan(highFirst.indexOf(second.id))

    // Flip only the importance. Relevance, freshness and quality are unchanged,
    // so a different order can only come from the importance term.
    setScore(db, first.id, 0)
    setScore(db, second.id, 1)
    const highSecond = memories.assembleContext('杭州', 'personal').selected.map((item) => item.id)
    expect(highSecond.indexOf(second.id)).toBeLessThan(highSecond.indexOf(first.id))
  })

  it('cannot rescue a memory that is not relevant to the query', () => {
    const { db, memories } = build()
    const relevant = memories.create('我住在杭州。', 'personal')
    const unrelated = memories.create('我的车是蓝色的。', 'personal')
    setScore(db, relevant.id, 0)
    setScore(db, unrelated.id, 1)

    const selected = memories.assembleContext('杭州', 'personal').selected.map((item) => item.id)
    expect(selected).toContain(relevant.id)
    // Admission is decided before ranking: a maximally important memory that
    // shares no term with the query is still not retrieved.
    expect(selected).not.toContain(unrelated.id)
  })
})

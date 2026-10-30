import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { MemoryService } from './memory-service'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { ARCHIVE_THRESHOLD, MemoryImportanceService, IMPORTANCE_VERSION, scoreMemory } from './memory-importance'

let directory = ''
let database: SqliteDatabase | undefined
afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  directory = ''
})

function openDatabase(): SqliteDatabase {
  directory = mkdtempSync(join(tmpdir(), 'morrow-importance-'))
  database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  return database
}

const NOW = '2026-10-30T00:00:00.000Z'

describe('importance scoring', () => {
  it('rates an explicitly important fact above a passing remark', () => {
    const important = scoreMemory({
      record: { currentText: '请记住：我对花生过敏，这很重要。', sourceCategory: 'user_explicit_input', updatedAt: NOW, revision: 1 },
      now: NOW
    })
    const passing = scoreMemory({
      record: { currentText: '今天路过一家咖啡店。', sourceCategory: 'turn_derived_confirmed', updatedAt: NOW, revision: 1 },
      now: NOW
    })
    expect(important.score).toBeGreaterThan(passing.score)
    expect(important.protected).toBe(true)
    expect(passing.protected).toBe(false)
  })

  it('protects a corrected fact and a goal-linked fact from time decay', () => {
    const corrected = scoreMemory({
      record: { currentText: '我住在苏州。', sourceCategory: 'user_explicit_input', updatedAt: '2025-01-01T00:00:00.000Z', revision: 2 },
      corrected: true,
      now: NOW
    })
    const goal = scoreMemory({
      record: { currentText: '我的目标是今年完成这个项目。', sourceCategory: 'user_explicit_input', updatedAt: '2025-01-01T00:00:00.000Z', revision: 1 },
      now: NOW
    })
    expect(corrected.protected).toBe(true)
    expect(goal.protected).toBe(true)
    // Recency is nearly zero for a two-year-old memory, so the protection is
    // what keeps these alive, not the score.
    expect(corrected.components.recency).toBeLessThan(0.01)
  })

  it('lets repetition raise a score without ever reaching 1 on its own', () => {
    const base = { currentText: '我在做一个项目。', sourceCategory: 'turn_derived_confirmed' as const, updatedAt: NOW, revision: 1 }
    const once = scoreMemory({ record: base, now: NOW })
    const many = scoreMemory({ record: { ...base, revision: 9 }, now: NOW })
    expect(many.components.repetition).toBeGreaterThan(once.components.repetition)
    expect(many.components.repetition).toBeLessThanOrEqual(1)
  })

  it('decays with age', () => {
    const fresh = scoreMemory({ record: { currentText: '随便聊聊。', sourceCategory: 'turn_derived_confirmed', updatedAt: NOW, revision: 1 }, now: NOW })
    const old = scoreMemory({ record: { currentText: '随便聊聊。', sourceCategory: 'turn_derived_confirmed', updatedAt: '2025-10-30T00:00:00.000Z', revision: 1 }, now: NOW })
    expect(old.score).toBeLessThan(fresh.score)
  })
})

describe('importance service', () => {
  function build() {
    const db = openDatabase()
    const importance = new MemoryImportanceService(db, () => NOW)
    const memories = new MemoryService(new SqliteMemoryRepository(db), () => NOW, () => randomUUID(), undefined, { importance })
    return { db, importance, memories }
  }

  it('records a score whenever a memory changes', () => {
    const { importance, memories } = build()
    const memory = memories.create('我住在杭州。', 'personal')
    const first = importance.get(memory.id)
    expect(first).not.toBeNull()
    expect(first!.score).toBeGreaterThan(0)
    memories.correct(memory.id, '我住在苏州。')
    const after = importance.get(memory.id)
    expect(after).not.toBeNull()
    expect(after!.components.correction).toBe(1)
  })

  it('archives only low-importance memories that are old enough', () => {
    const { db, importance, memories } = build()
    const chatter = memories.create('今天随便聊聊。', 'normal')
    const fresh = memories.create('我刚刚提了一句天气。', 'normal')
    const important = memories.create('请记住，这很重要：我的护照在抽屉里。', 'personal')
    // Backdate only the chatter: the age floor is what is under test, and a
    // memory created a second ago must never be archived.
    db.connection.prepare("UPDATE memories SET source_category = 'turn_derived_confirmed', updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(chatter.id)

    const archived = importance.archiveBelow(ARCHIVE_THRESHOLD, 180)
    expect(archived).toContain(chatter.id)
    expect(archived).not.toContain(important.id)
    expect(archived).not.toContain(fresh.id)
    const rows = memories.list()
    expect(rows.find((item) => item.id === chatter.id)!.archivedAt).not.toBeNull()
    expect(rows.find((item) => item.id === important.id)!.archivedAt).toBeNull()
  })

  it('restores an archived memory without touching its content', () => {
    const { db, importance, memories } = build()
    const memory = memories.create('今天随便聊聊。', 'normal')
    db.connection.prepare("UPDATE memories SET source_category = 'turn_derived_confirmed', updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(memory.id)
    importance.archiveBelow(ARCHIVE_THRESHOLD, 180)
    expect(memories.list().find((item) => item.id === memory.id)!.archivedAt).not.toBeNull()
    expect(importance.restore(memory.id)).toBe(true)
    const restored = memories.list().find((item) => item.id === memory.id)!
    expect(restored.archivedAt).toBeNull()
    expect(restored.currentText).toBe(memory.currentText)
  })

  it('keeps archived memories out of the retrieval competition', () => {
    const { db, importance, memories } = build()
    const memory = memories.create('我住在杭州。', 'personal')
    const before = memories.assembleContext('我住在哪里？', 'personal')
    expect(before.selected.some((item) => item.id === memory.id)).toBe(true)
    db.connection.prepare("UPDATE memories SET source_category = 'turn_derived_confirmed', updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(memory.id)
    importance.archiveBelow(ARCHIVE_THRESHOLD, 180)
    const after = memories.assembleContext('我住在哪里？', 'personal')
    expect(after.selected.some((item) => item.id === memory.id)).toBe(false)
  })

  it('consolidates two statements of the same fact by reference, not by copy', () => {
    const { importance, memories } = build()
    // Two different sentences that state the same slot and value. Identical text
    // would be deduplicated by the service, which is not what this tests.
    const first = memories.create('我住在杭州。', 'personal')
    const second = memories.create('现在我住在杭州。', 'personal')
    const groups = importance.consolidate()
    const group = groups.find((item) => item.memberIds.includes(first.id))
    expect(group).toBeDefined()
    expect(group!.memberIds).toEqual(expect.arrayContaining([first.id, second.id]))
    // The consolidation references the memories; it does not create a new one.
    expect(memories.list()).toHaveLength(2)
    const listed = importance.consolidations()
    expect(listed.some((item) => item.memberIds.includes(first.id))).toBe(true)
  })

  it('drops a consolidation member once the memory is retracted', () => {
    const { importance, memories } = build()
    const first = memories.create('我住在杭州。', 'personal')
    const second = memories.create('现在我住在杭州。', 'personal')
    importance.consolidate()
    memories.retract(second.id)
    const listed = importance.consolidations()
    expect(listed.some((item) => item.memberIds.includes(second.id))).toBe(false)
    expect(listed.some((item) => item.memberIds.includes(first.id))).toBe(false)
  })

  it('stamps the parameter version on every cached score', () => {
    const { db, memories } = build()
    const memory = memories.create('我住在杭州。', 'personal')
    const row = db.connection.prepare('SELECT version FROM memory_importance WHERE memory_id = ?').get(memory.id) as { version: string }
    expect(row.version).toBe(IMPORTANCE_VERSION)
  })
})

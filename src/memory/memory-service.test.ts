import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApplicationError } from '../shared/errors'
import { MemoryService } from './memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteMemoryRepository } from '../persistence/memory-repository'

let directory = ''
let database: SqliteDatabase | undefined

function openService(path: string, clock?: () => string) {
  database = SqliteDatabase.open(path)
  return new MemoryService(new SqliteMemoryRepository(database), clock, () => randomUUID())
}

afterEach(() => {
  database?.close()
  database = undefined
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('traceable local memory lifecycle', () => {
  it('stores only explicit text with a fixed source category and inspectable creation history', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-create-'))
    const service = openService(join(directory, 'morrow.sqlite3'), () => '2026-10-22T01:00:00.000Z')
    const record = service.create('我明确选择保存的原始文字。')
    expect(record).toMatchObject({
      originalText: '我明确选择保存的原始文字。',
      currentText: '我明确选择保存的原始文字。',
      sourceCategory: 'user_explicit_input',
      status: 'active',
      revision: 1,
      createdAt: '2026-10-22T01:00:00.000Z',
      updatedAt: '2026-10-22T01:00:00.000Z'
    })
    expect(service.history(record.id)).toEqual([{
      memoryId: record.id,
      revision: 1,
      content: record.currentText,
      sourceCategory: 'user_explicit_input',
      status: 'active',
      changeType: 'created',
      createdAt: record.createdAt,
      previousRevision: null
    }])
    expect(database?.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%derived%'").all())
      .toEqual([])
  })

  it('preserves original text and a complete linear correction lineage', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-correct-'))
    let tick = 0
    const timestamps = [
      '2026-10-22T01:00:00.000Z',
      '2026-10-22T01:01:00.000Z',
      '2026-10-22T01:02:00.000Z'
    ]
    const service = openService(join(directory, 'morrow.sqlite3'), () => timestamps[tick++] ?? timestamps.at(-1)!)
    const created = service.create('原始内容')
    const firstCorrection = service.correct(created.id, '第一次更正')
    const secondCorrection = service.correct(created.id, '第二次更正')
    expect(secondCorrection).toMatchObject({
      originalText: '原始内容',
      currentText: '第二次更正',
      sourceCategory: 'user_explicit_input',
      revision: 3,
      createdAt: '2026-10-22T01:00:00.000Z',
      updatedAt: '2026-10-22T01:02:00.000Z'
    })
    expect(firstCorrection.revision).toBe(2)
    expect(service.history(created.id).map(({ revision, previousRevision, changeType, content }) => ({
      revision,
      previousRevision,
      changeType,
      content
    }))).toEqual([
      { revision: 1, previousRevision: null, changeType: 'created', content: '原始内容' },
      { revision: 2, previousRevision: 1, changeType: 'corrected', content: '第一次更正' },
      { revision: 3, previousRevision: 2, changeType: 'corrected', content: '第二次更正' }
    ])
  })

  it('hides retracted records from search and restores them only by explicit transition', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-state-'))
    const service = openService(join(directory, 'morrow.sqlite3'))
    const record = service.create('检索状态探针')
    service.retract(record.id)
    expect(service.list()).toMatchObject([{ id: record.id, status: 'retracted' }])
    expect(service.search('检索状态探针')).toEqual([])
    expect(() => service.retract(record.id)).toThrow(ApplicationError)
    service.restore(record.id)
    expect(service.search('检索状态探针')).toMatchObject([{ id: record.id, status: 'active' }])
    expect(service.history(record.id).map((revision) => revision.changeType))
      .toEqual(['created', 'retracted', 'restored'])
  })

  it('hard-deletes the primary record and every revision across database reopen', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-delete-'))
    const path = join(directory, 'morrow.sqlite3')
    const service = openService(path)
    const record = service.create('不可恢复检索探针')
    service.correct(record.id, '更新后的探针')
    service.retract(record.id)
    service.delete(record.id)
    expect(service.list()).toEqual([])
    expect(service.search('探针')).toEqual([])
    expect(database?.connection.prepare('SELECT COUNT(*) AS count FROM memory_revisions').get())
      .toEqual({ count: 0 })
    database?.close()
    database = undefined
    const reopened = openService(path)
    expect(reopened.list()).toEqual([])
    expect(reopened.search('探针')).toEqual([])
    expect(() => reopened.history(record.id)).toThrow(ApplicationError)
  })

  it('rolls back state changes when revision insertion fails', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-rollback-'))
    const service = openService(join(directory, 'morrow.sqlite3'))
    const record = service.create('保持不变的旧内容')
    database?.connection.exec(`
      CREATE TRIGGER fail_revision_insert
      BEFORE INSERT ON memory_revisions
      WHEN NEW.change_type = 'corrected'
      BEGIN
        SELECT RAISE(ABORT, 'private path and content');
      END;
    `)
    expect(() => service.correct(record.id, '不应留下的半成品')).toThrow()
    expect(service.list()).toMatchObject([{ id: record.id, currentText: '保持不变的旧内容', revision: 1 }])
    expect(service.history(record.id)).toHaveLength(1)
    expect(database?.connection.prepare('SELECT COUNT(*) AS count FROM memory_revisions').get())
      .toEqual({ count: 1 })
  })

  it('uses status-filtered parameterized search and rejects empty or oversized queries', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-memory-search-'))
    const service = openService(join(directory, 'morrow.sqlite3'))
    const record = service.create("quote ' OR 1=1 -- literal")
    expect(service.search("' OR 1=1 --")).toMatchObject([{ id: record.id, status: 'active' }])
    expect(() => service.search('   ')).toThrow()
    expect(() => service.search('x'.repeat(257))).toThrow()
  })
})

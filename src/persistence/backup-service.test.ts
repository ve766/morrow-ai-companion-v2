import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ApplicationError } from '../shared/errors'
import { MemoryService } from '../memory/memory-service'
import { ConversationService } from '../conversation/conversation-service'
import { BackupService, swapRestoredDatabase } from './backup-service'
import { SqliteDatabase } from './database'
import { applyMigrations, CURRENT_SCHEMA_VERSION, DEGRADED_OPEN_MINIMUM_VERSION, migrations } from './migrations'

// 'deletion-boundary-journal' landed in schema v11; backups older than that restore only with explicit acknowledgement.
const PRE_JOURNAL_SCHEMA_VERSION = migrations.find((migration) => migration.name === 'deletion-boundary-journal')!.version - 1
import { SqliteConversationRepository } from './conversation-repository'
import { SqliteMemoryRepository } from './memory-repository'
import { readLatestDeletionStates } from './deletion-journal'

const directories: string[] = []
const openDatabases: SqliteDatabase[] = []
const clockSequence = (() => {
  let index = 0
  return () => new Date(Date.UTC(2026, 9, 25, 0, 0, index++)).toISOString()
})()

afterEach(() => {
  while (openDatabases.length > 0) {
    try { openDatabases.pop()?.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) {
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      } catch { // a locked profile must not mask the original test failure
      }
    }
  }
})

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

interface Workspace {
  database: SqliteDatabase
  databasePath: string
  profileDirectory: string
  memories: MemoryService
  conversations: ConversationService
  service: BackupService
  close: () => void
}

function createWorkspace(): Workspace {
  const profileDirectory = join(tempDirectory('morrow-backup-profile-'), 'profile')
  const databasePath = join(profileDirectory, 'morrow.sqlite3')
  const database = SqliteDatabase.open(databasePath)
  openDatabases.push(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), clockSequence, () => randomUUID())
  const conversations = new ConversationService(new SqliteConversationRepository(database), clockSequence, () => randomUUID())
  const service = new BackupService(database, databasePath)
  return {
    database,
    databasePath,
    profileDirectory,
    memories,
    conversations,
    service,
    close: () => database.close()
  }
}

interface ReopenedWorkspace {
  database: SqliteDatabase
  memories: MemoryService
  conversations: ConversationService
  close: () => void
}

function reopen(workspace: Workspace): ReopenedWorkspace {
  const database = SqliteDatabase.open(workspace.databasePath)
  openDatabases.push(database)
  return {
    database,
    memories: new MemoryService(new SqliteMemoryRepository(database), clockSequence, () => randomUUID()),
    conversations: new ConversationService(new SqliteConversationRepository(database), clockSequence, () => randomUUID()),
    close: () => database.close()
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function liveFingerprint(workspace: Workspace): { bytes: number; sha256: string } {
  workspace.database.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return { bytes: statSync(workspace.databasePath).size, sha256: sha256(workspace.databasePath) }
}

function expectLiveUnchanged(workspace: Workspace, before: { bytes: number; sha256: string }): void {
  expect(liveFingerprint(workspace)).toEqual(before)
}

interface BackupDirectory {
  directory: string
  databasePath: string
  manifestPath: string
}

function readBackupDirectory(directory: string): BackupDirectory {
  const name = readdirSync(directory).find((entry) => entry.startsWith('Morrow-Backup-') && !entry.endsWith('.tmp'))
  if (!name) throw new Error(`No backup directory inside ${directory}`)
  const backupDirectory = join(directory, name)
  return {
    directory: backupDirectory,
    databasePath: join(backupDirectory, 'morrow.sqlite3'),
    manifestPath: join(backupDirectory, 'manifest.json')
  }
}

function manifestValue(backup: BackupDirectory): { database: { bytes: number; sha256: string } } {
  return JSON.parse(readFileSync(backup.manifestPath, 'utf8'))
}

async function previewOf(service: BackupService, directory: string): Promise<Extract<Awaited<ReturnType<BackupService['preview']>>, { status: 'preview' }>> {
  const preview = await service.preview(directory)
  if (preview.status !== 'preview') throw new Error('expected a backup preview')
  return preview
}

function createLegacyBackup(targetVersion: number, memories: Array<{ text: string }>): string {
  const directory = tempDirectory('morrow-backup-legacy-')
  const databasePath = join(directory, 'morrow.sqlite3')
  const connection = new DatabaseSync(databasePath)
  applyMigrations(connection, targetVersion)
  for (const memory of memories) {
    connection.prepare("INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, updated_at, revision) VALUES (?, ?, ?, 'user_explicit_input', 'active', ?, ?, 1)")
      .run(randomUUID(), memory.text, memory.text, clockSequence(), clockSequence())
  }
  connection.close()
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    format: 'morrow-backup',
    formatVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    application: { databaseFile: 'morrow.sqlite3', schemaVersion: targetVersion },
    counts: { conversations: 0, messages: 0, memories: memories.length, retractedMemories: 0, deletionJournalEntries: 0 },
    database: { bytes: statSync(databasePath).size, sha256: sha256(databasePath) }
  }))
  return directory
}

function copyCorruptedBackup(exportedDirectory: string, mutate: (paths: { databasePath: string; manifestPath: string }) => void): string {
  const corrupted = tempDirectory('morrow-backup-corrupt-')
  const name = readdirSync(exportedDirectory)[0]
  if (!name) throw new Error('Export directory is empty')
  cpSync(join(exportedDirectory, name), join(corrupted, name), { recursive: true })
  const backup = readBackupDirectory(corrupted)
  mutate({ databasePath: backup.databasePath, manifestPath: backup.manifestPath })
  return corrupted
}

describe('backup export', () => {
  it('creates a self-contained validated snapshot with a manifest', async () => {
    const workspace = createWorkspace()
    const conversation = workspace.conversations.create('备份验证对话')
    workspace.conversations.appendMessage(conversation.id, 'user', '第一条用户消息', randomUUID())
    workspace.conversations.appendMessage(conversation.id, 'assistant', '第一条助手回复', randomUUID())
    workspace.memories.create('保持有效的记忆', 'personal')
    const retracted = workspace.memories.create('已撤销的记忆', 'personal')
    workspace.memories.retract(retracted.id)

    const target = tempDirectory('morrow-backup-target-')
    const result = await workspace.service.export(target)

    expect(result.status).toBe('created')
    expect(result.counts).toEqual({ conversations: 1, messages: 2, memories: 2, retractedMemories: 1, deletionJournalEntries: 1 })
    const backup = readBackupDirectory(target)
    expect(result.directory).toBe(backup.directory)
    expect(readdirSync(backup.directory).sort()).toEqual(['manifest.json', 'morrow.sqlite3'])

    const manifest = JSON.parse(readFileSync(backup.manifestPath, 'utf8'))
    expect(manifest.format).toBe('morrow-backup')
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.application.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(manifest.application.databaseFile).toBe('morrow.sqlite3')
    expect(manifest.database.bytes).toBe(statSync(backup.databasePath).size)
    expect(manifest.database.sha256).toBe(sha256(backup.databasePath))
    expect(manifest.counts).toEqual(result.counts)

    const snapshot = new DatabaseSync(backup.databasePath, { readOnly: true, enableForeignKeyConstraints: true })
    try {
      expect(snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      expect(snapshot.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(Number(snapshot.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version)).toBe(CURRENT_SCHEMA_VERSION)
      expect(Number(snapshot.prepare('SELECT count(*) AS count FROM memories').get()?.count)).toBe(2)
      expect(Number(snapshot.prepare("SELECT count(*) AS count FROM deletion_journal WHERE state = 'retracted'").get()?.count)).toBe(1)
    } finally {
      snapshot.close()
    }
  })

  it('excludes credentials, logs and unrelated files by construction', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('表格清单检查', 'normal')
    const target = tempDirectory('morrow-backup-target-')
    await workspace.service.export(target)
    const backup = readBackupDirectory(target)

    const snapshot = new DatabaseSync(backup.databasePath, { readOnly: true })
    const tables = (snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name).sort()
    snapshot.close()
    expect(tables.some((name) => /secret|credential|token|log|temp|ciphertext/i.test(name))).toBe(false)
    expect(tables).toContain('deletion_journal')
    expect(readdirSync(backup.directory).sort()).toEqual(['manifest.json', 'morrow.sqlite3'])
  })

  it('refuses to overwrite an existing backup directory', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('同名目录冲突', 'normal')
    const target = tempDirectory('morrow-backup-target-')
    const fixedClock = new BackupService(workspace.database, workspace.databasePath, { now: () => 1_000 })
    await fixedClock.export(target)
    await expect(fixedClock.export(target)).rejects.toThrow(new ApplicationError('CONFLICT'))
  })
})

describe('backup preview', () => {
  it('returns counts, schema version and a single-use token without touching live data', async () => {
    const workspace = createWorkspace()
    const conversation = workspace.conversations.create('预览一致性')
    workspace.conversations.appendMessage(conversation.id, 'user', '预览消息', randomUUID())
    workspace.memories.create('预览记忆', 'personal')
    const target = tempDirectory('morrow-backup-target-')
    const exported = await workspace.service.export(target)

    const before = liveFingerprint(workspace)
    const preview = await workspace.service.preview(exported.directory)
    expectLiveUnchanged(workspace, before)

    expect(preview.status).toBe('preview')
    expect(preview.counts).toEqual({ conversations: 1, messages: 1, memories: 1, retractedMemories: 0, deletionJournalEntries: 0 })
    expect(preview.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(preview.missingDeletionJournal).toBe(false)
    expect(preview.token).toMatch(/^[0-9a-f]{32}$/)
    expect(preview.boundaryNotice).toContain('删除')
    workspace.close()
  })

  it('flags backups that predate the deletion journal', async () => {
    const workspace = createWorkspace()
    const legacyDirectory = createLegacyBackup(PRE_JOURNAL_SCHEMA_VERSION, [{ text: '旧 schema 记忆' }])
    const preview = await workspace.service.preview(legacyDirectory)
    expect(preview.missingDeletionJournal).toBe(true)
    expect(preview.schemaVersion).toBe(PRE_JOURNAL_SCHEMA_VERSION)
    workspace.close()
  })

  it('rejects tampered, truncated, unknown-version and path-escaping backups', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('篡改检测基准', 'normal')
    const target = tempDirectory('morrow-backup-target-')
    await workspace.service.export(target)
    const backup = readBackupDirectory(target)
    const originalManifest = readFileSync(backup.manifestPath, 'utf8')

    const invalidPreviews: Array<[string, () => Promise<unknown>]> = [
      ['truncated database', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          writeFileSync(manifestPath, originalManifest)
        })
        const copy = readBackupDirectory(corrupted)
        const truncatedSize = Math.min(4096, Math.floor(statSync(copy.databasePath).size / 2))
        writeFileSync(copy.databasePath, readFileSync(copy.databasePath).subarray(0, truncatedSize))
        const manifest = manifestValue(copy)
        manifest.database.bytes = statSync(copy.databasePath).size
        manifest.database.sha256 = sha256(copy.databasePath)
        writeFileSync(copy.manifestPath, JSON.stringify(manifest))
        return workspace.service.preview(corrupted)
      }],
      ['hash mismatch', async () => {
        const corrupted = copyCorruptedBackup(target, ({ databasePath, manifestPath }) => {
          writeFileSync(databasePath, Buffer.concat([readFileSync(databasePath), Buffer.from([0x00])]))
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { database: { bytes: number } }
          manifest.database.bytes = statSync(databasePath).size
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['invalid manifest json', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => writeFileSync(manifestPath, '{not json'))
        return workspace.service.preview(corrupted)
      }],
      ['unknown format version', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { formatVersion: number }
          manifest.formatVersion = 99
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['wrong format marker', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { format: string }
          manifest.format = 'other-product-backup'
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['manifest path escape', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { application: { databaseFile: string } }
          manifest.application.databaseFile = '..\\morrow.sqlite3'
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['future schema version', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { application: { schemaVersion: number } }
          manifest.application.schemaVersion = CURRENT_SCHEMA_VERSION + 1
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['too old schema version', async () => {
        return workspace.service.preview(createLegacyBackup(DEGRADED_OPEN_MINIMUM_VERSION - 1, []))
      }],
      ['manifest counts mismatch', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { counts: { memories: number } }
          manifest.counts.memories += 5
          writeFileSync(manifestPath, JSON.stringify(manifest))
        })
        return workspace.service.preview(corrupted)
      }],
      ['missing manifest', async () => {
        const corrupted = copyCorruptedBackup(target, ({ manifestPath }) => rmSync(manifestPath))
        return workspace.service.preview(corrupted)
      }],
      ['missing database file', async () => {
        const corrupted = copyCorruptedBackup(target, ({ databasePath }) => rmSync(databasePath))
        return workspace.service.preview(corrupted)
      }],
      ['not a backup directory', async () => {
        return workspace.service.preview(tempDirectory('morrow-backup-empty-'))
      }]
    ]

    const before = liveFingerprint(workspace)
    for (const [label, attempt] of invalidPreviews) {
      await expect(attempt(), `preview must reject: ${label}`).rejects.toThrow(new ApplicationError('BACKUP_INVALID'))
    }
    expectLiveUnchanged(workspace, before)
    workspace.close()
  })
})

describe('backup restore', () => {
  it('replaces live data and re-applies deletions recorded after the backup', async () => {
    const workspace = createWorkspace()
    const conversation = workspace.conversations.create('恢复验证对话')
    workspace.conversations.appendMessage(conversation.id, 'user', '备份内的用户消息', randomUUID())
    const kept = workspace.memories.create('备份内保持有效的记忆', 'personal')
    const retracted = workspace.memories.create('备份内已撤销的记忆', 'personal')
    workspace.memories.retract(retracted.id)
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))

    workspace.memories.delete(kept.id)
    workspace.memories.create('备份后新建的记忆', 'personal')
    const laterConversation = workspace.conversations.create('备份后新建的对话')
    workspace.conversations.appendMessage(laterConversation.id, 'user', '备份后的消息', randomUUID())

    const preview = await previewOf(workspace.service, exported.directory)
    const result = await workspace.service.restore({ token: preview.token, confirmed: true })

    expect(result.status).toBe('restored')
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.reappliedDeletions).toBe(1)
    expect(result.reappliedRetractions).toBe(0)

    const restored = reopen(workspace)
    try {
      expect(restored.database.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(restored.memories.list().map((memory) => memory.currentText).sort()).toEqual(['备份内已撤销的记忆'])
      expect(restored.memories.list().some((memory) => memory.status === 'retracted')).toBe(true)
      expect(restored.conversations.list().map((entry) => entry.id)).toEqual([conversation.id])
      expect(restored.conversations.read(conversation.id).messages).toHaveLength(1)
      expect(readLatestDeletionStates(restored.database).get(`memory:${kept.id}`)?.state).toBe('deleted')
      expect(readLatestDeletionStates(restored.database).get(`conversation:${laterConversation.id}`)).toBeUndefined()
    } finally {
      restored.close()
    }
    workspace.close()
  })

  it('keeps the visible memory timeline consistent with the deletion boundary after restore', async () => {
    const workspace = createWorkspace()
    // Timeline preservation: retracting AFTER the backup is re-applied on top
    // of the restored lineage, so the timeline explains the current state.
    const retractedLater = workspace.memories.create('导出后撤销的记忆', 'personal')
    workspace.memories.correct(retractedLater.id, '导出后撤销的记忆（更正后）')
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))
    workspace.memories.retract(retractedLater.id)

    // Deletion boundary: deleting AFTER the backup must not resurrect the
    // memory or invent any timeline for it.
    const deletedAfterBackup = workspace.memories.create('导出后删除的记忆', 'personal')
    workspace.memories.delete(deletedAfterBackup.id)

    const preview = await previewOf(workspace.service, exported.directory)
    const result = await workspace.service.restore({ token: preview.token, confirmed: true })
    // The post-backup deletion matches no restored row (counted 0), while the
    // post-backup retraction re-applies onto the restored active memory.
    expect(result.reappliedDeletions).toBe(0)
    expect(result.reappliedRetractions).toBe(1)

    const restored = reopen(workspace)
    try {
      expect(restored.memories.list().some((entry) => entry.id === deletedAfterBackup.id)).toBe(false)
      // No visible timeline exists for a hard-deleted memory: the UI must not
      // invent history for it.
      expect(() => restored.memories.history(deletedAfterBackup.id)).toThrow()
      const lineage = restored.memories.history(retractedLater.id)
      expect(lineage?.map((entry) => entry.changeType)).toEqual(['created', 'corrected', 'retracted'])
      expect(lineage?.at(-1)?.status).toBe('retracted')
      expect(restored.memories.list().find((entry) => entry.id === retractedLater.id)?.status).toBe('retracted')
    } finally {
      restored.close()
    }
    workspace.close()
  })

  it('keeps explicitly un-retracted memories active after restoring an older backup', async () => {
    const workspace = createWorkspace()
    const memory = workspace.memories.create('先撤销再恢复的记忆', 'personal')
    workspace.memories.retract(memory.id)
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))
    workspace.memories.restore(memory.id)
    expect(workspace.memories.list()[0]?.status).toBe('active')

    const preview = await previewOf(workspace.service, exported.directory)
    await workspace.service.restore({ token: preview.token, confirmed: true })
    const restored = reopen(workspace)
    try {
      expect(restored.memories.list().find((entry) => entry.id === memory.id)?.status).toBe('active')
    } finally {
      restored.close()
    }
    workspace.close()
  })

  it('keeps memories deleted after the backup out of the model context after restore', async () => {
    const workspace = createWorkspace()
    const memory = workspace.memories.create('上下文排除验证', 'personal')
    workspace.memories.retract(memory.id)
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))
    workspace.memories.delete(memory.id)

    const preview = await previewOf(workspace.service, exported.directory)
    const result = await workspace.service.restore({ token: preview.token, confirmed: true })
    expect(result.reappliedDeletions).toBe(1)
    const restored = reopen(workspace)
    try {
      expect(restored.memories.list().some((entry) => entry.id === memory.id)).toBe(false)
      expect(restored.memories.assembleContext('上下文排除验证', 'sensitive').selected).toHaveLength(0)
      expect(readLatestDeletionStates(restored.database).get(`memory:${memory.id}`)?.state).toBe('deleted')
    } finally {
      restored.close()
    }
    workspace.close()
  })

  it('restores a pre-journal backup only with explicit acknowledgement and keeps current boundaries', async () => {
    const workspace = createWorkspace()
    const conversation = workspace.conversations.create('旧格式恢复对话')
    workspace.conversations.appendMessage(conversation.id, 'user', '旧格式消息', randomUUID())
    const deletedAfterBackup = workspace.memories.create('旧格式之后删除的记忆', 'personal')
    workspace.memories.delete(deletedAfterBackup.id)

    const legacyDirectory = createLegacyBackup(PRE_JOURNAL_SCHEMA_VERSION, [{ text: '旧格式记忆内容' }])
    const preview = await previewOf(workspace.service, legacyDirectory)
    expect(preview.missingDeletionJournal).toBe(true)

    await expect(workspace.service.restore({ token: preview.token, confirmed: true }))
      .rejects.toThrow(new ApplicationError('INVALID_INPUT'))
    expect(workspace.memories.list().some((memory) => memory.id === deletedAfterBackup.id)).toBe(false)

    const result = await workspace.service.restore({ token: preview.token, confirmed: true, acknowledgeMissingDeletionJournal: true })
    expect(result.status).toBe('restored')
    const restored = reopen(workspace)
    try {
      expect(restored.database.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(restored.memories.list().some((memory) => memory.currentText === '旧格式记忆内容')).toBe(true)
      expect(restored.memories.list().some((memory) => memory.id === deletedAfterBackup.id)).toBe(false)
      expect(restored.conversations.list()).toHaveLength(0)
      expect(readLatestDeletionStates(restored.database).get(`memory:${deletedAfterBackup.id}`)?.state).toBe('deleted')
    } finally {
      restored.close()
    }
    workspace.close()
  })

  it('refuses restore without confirmation, with an unknown token, or with a consumed token', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('令牌校验基准', 'normal')
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))
    const preview = await previewOf(workspace.service, exported.directory)
    const before = liveFingerprint(workspace)

    await expect(workspace.service.restore({ token: preview.token, confirmed: false }))
      .rejects.toThrow(new ApplicationError('INVALID_INPUT'))
    await expect(workspace.service.restore({ token: '0'.repeat(32), confirmed: true }))
      .rejects.toThrow(new ApplicationError('NOT_FOUND'))
    expectLiveUnchanged(workspace, before)

    await workspace.service.restore({ token: preview.token, confirmed: true })
    await expect(workspace.service.restore({ token: preview.token, confirmed: true }))
      .rejects.toThrow(new ApplicationError('NOT_FOUND'))
    workspace.close()
  })

  it('expires unused preview tokens', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('过期令牌基准', 'normal')
    const service = new BackupService(workspace.database, workspace.databasePath, { tokenTtlMs: 1 })
    const exported = await service.export(tempDirectory('morrow-backup-target-'))
    const preview = await previewOf(service, exported.directory)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(service.restore({ token: preview.token, confirmed: true }))
      .rejects.toThrow(new ApplicationError('NOT_FOUND'))
    workspace.close()
  })

  it('leaves the original database intact and reopenable when the swap fails', () => {
    const workspace = createWorkspace()
    const memory = workspace.memories.create('原子失败保护', 'personal')
    workspace.database.close()

    const stagedDirectory = tempDirectory('morrow-backup-stage-')
    const stagedPath = join(stagedDirectory, 'staged.sqlite3')
    writeFileSync(stagedPath, 'definitely not a sqlite database')

    expect(() => swapRestoredDatabase(stagedPath, workspace.databasePath))
      .toThrow(new ApplicationError('STORAGE_ERROR'))

    const reopened = SqliteDatabase.open(workspace.databasePath)
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(new MemoryService(new SqliteMemoryRepository(reopened)).list().some((entry) => entry.id === memory.id)).toBe(true)
    reopened.close()
  })

  it('restores only from the exact previewed backup and re-validates before swap', async () => {
    const workspace = createWorkspace()
    workspace.memories.create('源一致性基准', 'normal')
    const exported = await workspace.service.export(tempDirectory('morrow-backup-target-'))
    const preview = await previewOf(workspace.service, exported.directory)

    const backupDatabasePath = join(exported.directory, 'morrow.sqlite3')
    const backupManifestPath = join(exported.directory, 'manifest.json')
    writeFileSync(backupDatabasePath, 'replaced after preview')
    const manifest = JSON.parse(readFileSync(backupManifestPath, 'utf8')) as { database: { bytes: number; sha256: string } }
    manifest.database.bytes = statSync(backupDatabasePath).size
    manifest.database.sha256 = sha256(backupDatabasePath)
    writeFileSync(backupManifestPath, JSON.stringify(manifest))

    await expect(workspace.service.restore({ token: preview.token, confirmed: true }))
      .rejects.toThrow(new ApplicationError('BACKUP_INVALID'))
    workspace.close()
  })
})

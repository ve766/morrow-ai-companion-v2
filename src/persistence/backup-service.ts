import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { ApplicationError } from '../shared/errors'
import { SqliteDatabase } from './database'
import { CURRENT_SCHEMA_VERSION } from './migrations'
import { mergeDeletionJournal, readDeletionJournal, type DeletionJournalEntry } from './deletion-journal'

export const BACKUP_FORMAT = 'morrow-backup'
export const BACKUP_FORMAT_VERSION = 1
const BACKUP_DATABASE_FILE = 'morrow.sqlite3'
const BACKUP_MANIFEST_FILE = 'manifest.json'
const MANIFEST_MAX_BYTES = 1_000_000
const DATABASE_MAX_BYTES = 2_000_000_000

export interface BackupCounts {
  conversations: number
  messages: number
  memories: number
  retractedMemories: number
  deletionJournalEntries: number
}

export interface BackupExportResult {
  status: 'created'
  directory: string
  createdAt: string
  counts: BackupCounts
}

export interface BackupPreviewResult {
  status: 'preview'
  token: string
  createdAt: string
  schemaVersion: number
  counts: BackupCounts
  missingDeletionJournal: boolean
  boundaryNotice: string
}

export interface BackupRestoreResult {
  status: 'restored'
  schemaVersion: number
  reappliedDeletions: number
  reappliedRetractions: number
  reappliedUnretractions: number
}

interface BackupManifest {
  format: string
  formatVersion: number
  createdAt: string
  application: { databaseFile: string; schemaVersion: number }
  counts: BackupCounts
  database: { bytes: number; sha256: string }
}

interface BackupRecord {
  directory: string
  createdAt: string
  schemaVersion: number
  counts: BackupCounts
  missingDeletionJournal: boolean
  databaseSha256: string
  manifestSha256: string
}

interface PreviewRecord extends BackupRecord {
  issuedAt: number
}

export const RESTORE_BOUNDARY_NOTICE =
  '恢复将把当前全部本地数据替换为备份内容。备份之后删除或撤销的记忆与对话会依据删除记录保持删除或撤销状态；' +
  '若备份早于删除记录功能，则无法保证此前删除或撤销的内容保持原状，需要你单独确认。'

function failInvalid(): never {
  throw new ApplicationError('BACKUP_INVALID')
}

function appendBoundaryRevision(
  readMemory: StatementSync,
  nextRevision: StatementSync,
  insertRevision: StatementSync,
  memoryId: string,
  changeType: 'retracted' | 'restored',
  boundaryAt: string
): void {
  const memory = readMemory.get(memoryId) as unknown as { id: string; current_text: string; revision: number } | undefined
  if (!memory) return
  const next = Number((nextRevision.get(memoryId) as unknown as { next: number } | undefined)?.next)
  insertRevision.run(
    memory.id,
    next,
    memory.current_text,
    changeType === 'restored' ? 'active' : 'retracted',
    changeType,
    boundaryAt,
    memory.revision
  )
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function snapshotCounts(connection: DatabaseSync, schemaVersion: number): BackupCounts {
  const count = (sql: string): number => Number(connection.prepare(sql).get()?.count ?? 0)
  return {
    conversations: count('SELECT count(*) AS count FROM conversations'),
    messages: count('SELECT count(*) AS count FROM messages'),
    memories: count('SELECT count(*) AS count FROM memories'),
    retractedMemories: count("SELECT count(*) AS count FROM memories WHERE status = 'retracted'"),
    deletionJournalEntries: schemaVersion >= 11
      ? count('SELECT count(*) AS count FROM deletion_journal')
      : 0
  }
}

function openValidatedSnapshot(path: string, expectedVersion: number): DatabaseSync {
  let snapshot: DatabaseSync | undefined
  try {
    snapshot = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true })
    if (snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') failInvalid()
    if (snapshot.prepare('PRAGMA foreign_key_check').all().length > 0) failInvalid()
    const version = Number(snapshot.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version ?? 0)
    if (version !== expectedVersion) failInvalid()
    return snapshot
  } catch (error) {
    try { snapshot?.close() } catch { /* ignore close failures on an invalid snapshot */ }
    if (error instanceof ApplicationError) throw error
    // Any unreadable, truncated or non-SQLite file is just an invalid backup;
    // underlying error details never reach the caller.
    failInvalid()
  }
}

// Atomically replaces the live database file with the staged, already
// validated file. The previous database is copied aside first and restored if
// the replacement cannot be opened and verified. Renames stay on one volume so
// the live path never holds a partially written file.
export function swapRestoredDatabase(stagedPath: string, databasePath: string): void {
  const rollbackPath = `${databasePath}.rollback-${randomUUID()}`
  try {
    if (existsSync(databasePath)) {
      copyFileSync(databasePath, rollbackPath)
      if (statSync(rollbackPath).size !== statSync(databasePath).size) failInvalid()
    }
    for (const suffix of ['-wal', '-shm']) {
      try { rmSync(`${databasePath}${suffix}`, { force: true }) } catch { /* best effort */ }
    }
    renameSync(stagedPath, databasePath)
    try {
      const reopened = new DatabaseSync(databasePath, { readOnly: true })
      try {
        if (reopened.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') failInvalid()
        reopened.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()
      } finally {
        reopened.close()
      }
    } catch (error) {
      try { rmSync(databasePath, { force: true }) } catch { /* rollback below still runs */ }
      throw error
    }
    try { rmSync(rollbackPath, { force: true }) } catch { /* a leftover rollback copy is harmless */ }
  } catch {
    try {
      if (existsSync(rollbackPath)) {
        rmSync(databasePath, { force: true })
        renameSync(rollbackPath, databasePath)
      }
    } catch {
      // The replacement could not be verified and the rollback rename failed;
      // the on-disk state is left exactly as produced by the failed swap.
    }
    throw new ApplicationError('STORAGE_ERROR')
  }
}

export class BackupService {
  private readonly tokens = new Map<string, PreviewRecord>()

  constructor(
    private readonly database: SqliteDatabase,
    private readonly databasePath: string,
    private readonly options: { now?: () => number; tokenTtlMs?: number } = {}
  ) {}

  async export(targetDirectory: string): Promise<BackupExportResult> {
    if (typeof targetDirectory !== 'string' || targetDirectory.length === 0 || targetDirectory.length > 500) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const createdAt = new Date(this.now()).toISOString()
    const backupName = `Morrow-Backup-${createdAt.replaceAll(/[-:]/g, '').replaceAll('.', '-')}`
    const backupDirectory = join(targetDirectory, backupName)
    if (existsSync(backupDirectory)) throw new ApplicationError('CONFLICT')

    try {
      mkdirSync(backupDirectory, { recursive: true })
      const temporaryPath = join(backupDirectory, `${BACKUP_DATABASE_FILE}.tmp`)
      const escaped = temporaryPath.replaceAll("'", "''")
      this.database.connection.exec(`VACUUM INTO '${escaped}'`)
      chmodSync(temporaryPath, 0o600)
      const counts = this.validateSnapshotFile(temporaryPath, CURRENT_SCHEMA_VERSION)
      renameSync(temporaryPath, join(backupDirectory, BACKUP_DATABASE_FILE))
      const databasePath = join(backupDirectory, BACKUP_DATABASE_FILE)
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt,
        application: { databaseFile: BACKUP_DATABASE_FILE, schemaVersion: CURRENT_SCHEMA_VERSION },
        counts,
        database: { bytes: statSync(databasePath).size, sha256: sha256(databasePath) }
      }
      writeFileSync(join(backupDirectory, BACKUP_MANIFEST_FILE), JSON.stringify(manifest, null, 2), { mode: 0o600 })
      return { status: 'created', directory: backupDirectory, createdAt, counts }
    } catch (error) {
      try { rmSync(backupDirectory, { recursive: true, force: true }) } catch { /* best effort cleanup */ }
      if (error instanceof ApplicationError) throw error
      throw new ApplicationError('STORAGE_ERROR')
    }
  }

  async preview(sourceDirectory: string): Promise<BackupPreviewResult> {
    const record = this.readBackup(sourceDirectory)
    const token = randomUUID().replaceAll('-', '')
    this.tokens.set(token, { ...record, issuedAt: this.now() })
    return {
      status: 'preview',
      token,
      createdAt: record.createdAt,
      schemaVersion: record.schemaVersion,
      counts: record.counts,
      missingDeletionJournal: record.missingDeletionJournal,
      boundaryNotice: RESTORE_BOUNDARY_NOTICE
    }
  }

  // Read-only token summary for the confirmation dialog; does not consume the
  // token and reveals no filesystem paths.
  async describeRestore(token: unknown): Promise<BackupPreviewResult | null> {
    if (typeof token !== 'string') return null
    const record = this.tokens.get(token)
    if (!record || this.now() - record.issuedAt > (this.options.tokenTtlMs ?? 600_000)) return null
    return {
      status: 'preview',
      token,
      createdAt: record.createdAt,
      schemaVersion: record.schemaVersion,
      counts: record.counts,
      missingDeletionJournal: record.missingDeletionJournal,
      boundaryNotice: RESTORE_BOUNDARY_NOTICE
    }
  }

  async restore(request: { token: unknown; confirmed: unknown; acknowledgeMissingDeletionJournal?: unknown }): Promise<BackupRestoreResult> {
    if (typeof request?.token !== 'string' || request.confirmed !== true) throw new ApplicationError('INVALID_INPUT')
    const record = this.tokens.get(request.token)
    if (!record || this.now() - record.issuedAt > (this.options.tokenTtlMs ?? 600_000)) {
      this.tokens.delete(request.token)
      throw new ApplicationError('NOT_FOUND')
    }
    if (record.missingDeletionJournal && request.acknowledgeMissingDeletionJournal !== true) {
      throw new ApplicationError('INVALID_INPUT')
    }
    // The token is single-use and is consumed only once a restore actually
    // proceeds, so a rejected confirmation does not invalidate the preview.
    this.tokens.delete(request.token)

    // Re-validate: the backup directory may have changed since the preview.
    const current = this.readBackup(record.directory)
    if (current.databaseSha256 !== record.databaseSha256 || current.manifestSha256 !== record.manifestSha256) failInvalid()

    const liveJournal = readDeletionJournal(this.database)
    const stagingDirectory = join(dirname(this.databasePath), `.restore-${randomUUID()}`)
    const stagedPath = join(stagingDirectory, BACKUP_DATABASE_FILE)
    let staged: SqliteDatabase | undefined
    try {
      mkdirSync(stagingDirectory, { recursive: true })
      copyFileSync(join(record.directory, BACKUP_DATABASE_FILE), stagedPath)
      chmodSync(stagedPath, 0o600)
      if (sha256(stagedPath) !== current.databaseSha256) failInvalid()

      staged = this.openStagedDatabase(stagedPath)
      const boundary = this.applyDeletionBoundary(staged, liveJournal)
      if (staged.connection.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') failInvalid()
      if (staged.connection.prepare('PRAGMA foreign_key_check').all().length > 0) failInvalid()
      if (staged.schemaVersion !== CURRENT_SCHEMA_VERSION) failInvalid()

      staged.close()
      this.database.close()
      swapRestoredDatabase(stagedPath, this.databasePath)
      return {
        status: 'restored',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        reappliedDeletions: boundary.reappliedDeletions,
        reappliedRetractions: boundary.reappliedRetractions,
        reappliedUnretractions: boundary.reappliedUnretractions
      }
    } catch (error) {
      try { staged?.close() } catch { /* best effort */ }
      try { rmSync(stagingDirectory, { recursive: true, force: true }) } catch { /* best effort cleanup */ }
      if (error instanceof ApplicationError) throw error
      throw new ApplicationError('STORAGE_ERROR')
    } finally {
      try { rmSync(stagingDirectory, { recursive: true, force: true }) } catch { /* best effort cleanup */ }
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private readBackup(sourceDirectory: string): BackupRecord {
    if (typeof sourceDirectory !== 'string' || sourceDirectory.length === 0 || sourceDirectory.length > 500) {
      throw new ApplicationError('INVALID_INPUT')
    }
    const manifestPath = join(sourceDirectory, BACKUP_MANIFEST_FILE)
    const databasePath = join(sourceDirectory, BACKUP_DATABASE_FILE)
    if (!existsSync(manifestPath) || !existsSync(databasePath)) failInvalid()
    if (statSync(manifestPath).size > MANIFEST_MAX_BYTES || statSync(databasePath).size > DATABASE_MAX_BYTES) failInvalid()

    let manifest: BackupManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest
    } catch {
      failInvalid()
    }
    if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== BACKUP_FORMAT_VERSION) failInvalid()
    if (manifest.application?.databaseFile !== BACKUP_DATABASE_FILE) failInvalid()
    if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) failInvalid()
    const schemaVersion = manifest.application?.schemaVersion
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion > CURRENT_SCHEMA_VERSION || schemaVersion < CURRENT_SCHEMA_VERSION - 2) failInvalid()
    const bytes = statSync(databasePath).size
    const digest = sha256(databasePath)
    if (manifest.database?.bytes !== bytes || manifest.database?.sha256 !== digest) failInvalid()

    const snapshot = openValidatedSnapshot(databasePath, schemaVersion)
    let counts: BackupCounts
    try {
      counts = snapshotCounts(snapshot, schemaVersion)
    } finally {
      snapshot.close()
    }
    const declared = manifest.counts
    if (!declared
      || declared.conversations !== counts.conversations
      || declared.messages !== counts.messages
      || declared.memories !== counts.memories
      || declared.retractedMemories !== counts.retractedMemories
      || declared.deletionJournalEntries !== counts.deletionJournalEntries) {
      failInvalid()
    }
    return {
      directory: sourceDirectory,
      createdAt: manifest.createdAt,
      schemaVersion,
      counts,
      missingDeletionJournal: schemaVersion < 11,
      databaseSha256: digest,
      manifestSha256: sha256(manifestPath)
    }
  }

  private validateSnapshotFile(path: string, expectedVersion: number): BackupCounts {
    const snapshot = openValidatedSnapshot(path, expectedVersion)
    try {
      return snapshotCounts(snapshot, expectedVersion)
    } finally {
      snapshot.close()
    }
  }

  private openStagedDatabase(stagedPath: string): SqliteDatabase {
    try {
      const staged = SqliteDatabase.open(stagedPath)
      if (staged.schemaVersion !== CURRENT_SCHEMA_VERSION) failInvalid()
      return staged
    } catch (error) {
      if (error instanceof ApplicationError) throw error
      failInvalid()
    }
  }

  private applyDeletionBoundary(staged: SqliteDatabase, liveJournal: DeletionJournalEntry[]): { reappliedDeletions: number; reappliedRetractions: number; reappliedUnretractions: number } {
    const merged = mergeDeletionJournal(liveJournal, readDeletionJournal(staged))
    let reappliedDeletions = 0
    let reappliedRetractions = 0
    let reappliedUnretractions = 0
    staged.transaction(() => {
      staged.connection.exec('DELETE FROM deletion_journal')
      const insert = staged.connection.prepare('INSERT INTO deletion_journal(entity, entity_id, state, recorded_at) VALUES (?, ?, ?, ?)')
      const deleteMemory = staged.connection.prepare('DELETE FROM memories WHERE id = ?')
      const deleteConversation = staged.connection.prepare('DELETE FROM conversations WHERE id = ?')
      const retractMemory = staged.connection.prepare("UPDATE memories SET status = 'retracted', updated_at = ? WHERE id = ? AND status = 'active'")
      const unretractMemory = staged.connection.prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND status = 'retracted'")
      const nextRevision = staged.connection.prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM memory_revisions WHERE memory_id = ?')
      const insertRevision = staged.connection.prepare(`
        INSERT INTO memory_revisions(memory_id, revision, content, source_category, status, change_type, created_at, previous_revision)
        VALUES (?, ?, ?, 'user_explicit_input', ?, ?, ?, ?)
      `)
      const readMemory = staged.connection.prepare('SELECT id, current_text, revision FROM memories WHERE id = ?')
      const boundaryAt = new Date(this.now()).toISOString()

      for (const entry of merged) {
        insert.run(entry.entity, entry.entityId, entry.state, entry.recordedAt)
      }
      for (const entry of merged) {
        if (entry.entity !== 'memory') {
          const result = deleteConversation.run(entry.entityId)
          if (result.changes === 1) reappliedDeletions += 1
          continue
        }
        if (entry.state === 'deleted') {
          if (deleteMemory.run(entry.entityId).changes === 1) reappliedDeletions += 1
        } else if (entry.state === 'retracted') {
          if (retractMemory.run(boundaryAt, entry.entityId).changes === 1) {
            reappliedRetractions += 1
            appendBoundaryRevision(readMemory, nextRevision, insertRevision, entry.entityId, 'retracted', boundaryAt)
          }
        } else {
          if (unretractMemory.run(boundaryAt, entry.entityId).changes === 1) {
            reappliedUnretractions += 1
            appendBoundaryRevision(readMemory, nextRevision, insertRevision, entry.entityId, 'restored', boundaryAt)
          }
        }
      }
    })
    return { reappliedDeletions, reappliedRetractions, reappliedUnretractions }
  }
}

import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations, CURRENT_SCHEMA_VERSION, DEGRADED_OPEN_MINIMUM_VERSION } from './migrations'

function currentVersion(connection: DatabaseSync): number {
  const schemaTable = connection.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!schemaTable) return 0
  const version = Number(connection.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version ?? 0)
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid database schema version.')
  return version
}

function backupIsValid(path: string, expectedVersion: number): boolean {
  let backup: DatabaseSync | undefined
  try {
    backup = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true })
    if (backup.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') return false
    return currentVersion(backup) === expectedVersion
  } catch {
    return false
  } finally {
    try { backup?.close() } catch {}
  }
}

function pruneMigrationBackups(directory: string, prefix: string): void {
  const backups = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .map((name) => ({ path: join(directory, name), modifiedAt: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
  for (const backup of backups.slice(2)) {
    try {
      rmSync(backup.path)
    } catch {
      continue
    }
  }
}

function cleanupMigrationBackups(directory: string, databaseName: string): void {
  const prefix = `${databaseName}.pre-v`
  const target = `-to-v${CURRENT_SCHEMA_VERSION}-`
  try {
    for (const name of readdirSync(directory)) {
      if (name.startsWith(prefix) && name.includes(target) && name.endsWith('.bak')) {
        rmSync(join(directory, name), { force: true })
      }
    }
  } catch {
    return
  }
}

function createMigrationBackup(connection: DatabaseSync, path: string, sourceVersion: number): void {
  const directory = dirname(path)
  const prefix = `${basename(path)}.pre-v${sourceVersion}-to-v${CURRENT_SCHEMA_VERSION}-`
  const backupPath = join(directory, `${prefix}${Date.now()}-${randomUUID()}.bak`)
  const temporaryPath = `${backupPath}.tmp`
  try {
    if (connection.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || currentVersion(connection) !== sourceVersion) {
      throw new Error('Source database is not ready for migration.')
    }
    const escapedPath = temporaryPath.replaceAll("'", "''")
    connection.exec(`VACUUM INTO '${escapedPath}'`)
    chmodSync(temporaryPath, 0o600)
    if (!backupIsValid(temporaryPath, sourceVersion)) throw new Error('Migration backup failed validation.')
    renameSync(temporaryPath, backupPath)
    pruneMigrationBackups(directory, prefix)
  } catch {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      throw new Error('Local storage upgrade backup failed.')
    }
    throw new Error('Local storage upgrade backup failed.')
  }
}

export class SqliteDatabase {
  readonly connection: DatabaseSync
  readonly schemaVersion: number
  readonly cognitivePersistenceAvailable: boolean
  private closed = false

  private constructor(readonly path: string, connection: DatabaseSync, schemaVersion: number, cognitivePersistenceAvailable: boolean) {
    this.connection = connection
    this.schemaVersion = schemaVersion
    this.cognitivePersistenceAvailable = cognitivePersistenceAvailable
  }

  static open(path: string): SqliteDatabase {
    const existingFile = path !== ':memory:' && existsSync(path)
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true })
    try {
      connection.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA secure_delete = ON;
        PRAGMA journal_mode = WAL;
      `)
      const sourceVersion = currentVersion(connection)
      if (existingFile && sourceVersion < CURRENT_SCHEMA_VERSION) createMigrationBackup(connection, path, sourceVersion)
      let version: number
      try {
        version = applyMigrations(connection)
      } catch {
        version = currentVersion(connection)
        if (version < DEGRADED_OPEN_MINIMUM_VERSION) throw new Error('Database migration failed.')
      }
      if (version < DEGRADED_OPEN_MINIMUM_VERSION || version > CURRENT_SCHEMA_VERSION) {
        throw new Error('Unexpected database schema version.')
      }
      const cognitiveTables = version === CURRENT_SCHEMA_VERSION &&
        Number(connection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('cognitive_turn_observations', 'cognitive_core_settings', 'cognitive_feeling_state', 'cognitive_feeling_events', 'cognitive_feeling_revisions')").get()?.count ?? 0) === 5
      if (existingFile && version === CURRENT_SCHEMA_VERSION && cognitiveTables) cleanupMigrationBackups(dirname(path), basename(path))
      return new SqliteDatabase(path, connection, version, cognitiveTables)
    } catch {
      try {
        connection.close()
      } catch {
        throw new Error('Local storage could not be opened.')
      }
      throw new Error('Local storage could not be opened.')
    }
  }

  /**
   * Runs `operation` in a transaction, nested or not.
   *
   * Nesting used to throw `cannot start a transaction within a transaction`,
   * and the callers that read state inside a write (the turn finalization reads
   * the committed feeling state) swallowed that error and carried on with a
   * default value. A nested call now becomes a savepoint, so an inner read sees
   * the outer transaction's uncommitted writes and an inner failure rolls back
   * only the inner work.
   */
  private transactionDepth = 0

  transaction<T>(operation: () => T): T {
    if (this.closed) throw new Error('Local storage is closed.')
    const nested = this.transactionDepth > 0
    const savepoint = `morrow_sp_${this.transactionDepth}`
    this.connection.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
    this.transactionDepth += 1
    try {
      const value = operation()
      this.transactionDepth -= 1
      this.connection.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT')
      return value
    } catch (error) {
      this.transactionDepth -= 1
      try {
        this.connection.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK')
        if (nested) this.connection.exec(`RELEASE ${savepoint}`)
      } catch {
        throw new Error('Local storage operation failed.')
      }
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.connection.close()
    this.closed = true
  }
}

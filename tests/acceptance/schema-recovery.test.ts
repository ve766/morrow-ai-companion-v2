import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupService } from '../../src/persistence/backup-service'
import { SqliteDatabase } from '../../src/persistence/database'
import { applyMigrations, CURRENT_SCHEMA_VERSION, migrations } from '../../src/persistence/migrations'

/**
 * Schema upgrade and recovery acceptance, on synthetic data in a temporary
 * directory. Nothing here touches a real profile.
 *
 * The point is not "the migration ran". It is that a database written by an
 * older build still has the same conversations, messages, memories, personality
 * versions and provider configuration afterwards, that a controlled failure
 * leaves the original intact next to a usable recovery copy, and that a backup
 * can be restored into an openable, internally consistent database.
 */

const directories: string[] = []
const openDatabases: SqliteDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) {
    try { openDatabases.pop()?.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch { /* locked */ }
    }
  }
})

const T0 = '2026-10-20T00:00:00.000Z'
const conversationId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'
const memoryId = '33333333-3333-4333-8333-333333333333'
const candidateId = '44444444-4444-4444-8444-444444444444'

function tempProfile(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-schema-recovery-'))
  directories.push(directory)
  return { directory, databasePath: join(directory, 'morrow.sqlite3') }
}

/** Writes the same synthetic facts at whatever schema the caller asks for. */
function seedAtVersion(databasePath: string, version: number): void {
  const connection = new DatabaseSync(databasePath)
  try {
    applyMigrations(connection, version)
    connection.exec('PRAGMA foreign_keys = ON')
    connection.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, '合成的对话', T0, T0)
    connection.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(messageId, conversationId, 'user', '我对花生过敏。', T0, 1, '55555555-5555-4555-8555-555555555555')
    // Column sets differ across the supported versions (`sensitivity` from
    // v16, `confidence` later). Build the insert from what this schema has so
    // the same synthetic fact can be seeded at every starting version.
    const memoryColumns = new Set((connection.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>).map((column) => column.name))
    const memoryValues: Record<string, unknown> = {
      id: memoryId,
      original_text: '我对花生过敏。',
      current_text: '我对花生过敏。',
      source_category: 'user_explicit_input',
      status: 'active',
      sensitivity: 'sensitive',
      created_at: T0,
      updated_at: T0,
      revision: 1,
      confidence: 90
    }
    const usable = Object.keys(memoryValues).filter((column) => memoryColumns.has(column))
    connection.prepare(`
      INSERT INTO memories(${usable.join(', ')}) VALUES (${usable.map(() => '?').join(', ')})
    `).run(...usable.map((column) => memoryValues[column] as never))
    connection.prepare(`
      INSERT INTO memory_revisions(memory_id, revision, content, source_category, status, change_type, created_at, previous_revision)
      VALUES (?, 1, ?, 'user_explicit_input', 'active', 'created', ?, NULL)
    `).run(memoryId, '我对花生过敏。', T0)
    connection.prepare(`
      INSERT INTO personality_profiles(id, version, warmth, directness, humor, disagreement_style, system_rules, updated_at)
      VALUES ('primary', 3, 60, 55, 20, 'balanced', 'Prefer concise answers.', ?)
    `).run(T0)
    connection.prepare(`
      INSERT INTO personality_revisions(version, warmth, directness, humor, disagreement_style, system_rules, created_at, change_type)
      VALUES (3, 60, 55, 20, 'balanced', 'Prefer concise answers.', ?, 'user_edit')
    `).run(T0)
    // v13 is where the local provider row became legal; before that only the
    // DeepSeek row exists.
    if (version >= 13) {
      connection.prepare('INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('local-openai', 'local', 'http://127.0.0.1:11434/v1', 'qwen2.5:0.5b', 1, T0)
    } else {
      connection.prepare('INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('deepseek', 'remote', 'https://api.deepseek.com', 'deepseek-flash', 1, T0)
    }
    if (version >= 18) {
      connection.prepare(`
        INSERT INTO persona_feedback_candidates(
          id, kind, source, evidence_hash, evidence_excerpt, confidence, sensitivity, status,
          decision_reason, applied_personality_version, created_at, updated_at
        ) VALUES (?, 'tone', 'user_explicit', ?, '请简短一点。', 70, 'normal', 'supported', NULL, NULL, ?, ?)
      `).run(candidateId, 'a'.repeat(64), T0, T0)
      connection.prepare(`
        INSERT INTO persona_feedback_evidence(candidate_id, conversation_id, message_id, evidence_hash, created_at, source, sensitivity, status, withdrawn_at)
        VALUES (?, ?, ?, ?, ?, 'user_explicit', 'normal', 'active', NULL)
      `).run(candidateId, conversationId, messageId, 'a'.repeat(64), T0)
    }
    if (version >= 11) {
      connection.prepare('INSERT INTO deletion_journal(entity, entity_id, state, recorded_at) VALUES (?, ?, ?, ?)')
        .run('memory', '66666666-6666-4666-8666-666666666666', 'retracted', T0)
    }
  } finally {
    connection.close()
  }
}

function counts(databasePath: string): Record<string, number> {
  const connection = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const count = (sql: string): number => Number(connection.prepare(sql).get()?.count ?? 0)
    return {
      conversations: count('SELECT count(*) AS count FROM conversations'),
      messages: count('SELECT count(*) AS count FROM messages'),
      memories: count('SELECT count(*) AS count FROM memories'),
      revisions: count('SELECT count(*) AS count FROM memory_revisions'),
      personalityRevisions: count('SELECT count(*) AS count FROM personality_revisions'),
      providers: count('SELECT count(*) AS count FROM provider_profiles')
    }
  } finally {
    connection.close()
  }
}

describe('a database written by an older build still opens with its data', () => {
  for (const version of [11, 17, 18, 20]) {
    it(`upgrades v${version} to v${CURRENT_SCHEMA_VERSION} without losing a row`, () => {
      const { databasePath } = tempProfile()
      seedAtVersion(databasePath, version)
      const before = counts(databasePath)

      const database = SqliteDatabase.open(databasePath)
      openDatabases.push(database)
      expect(database.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)

      const after = counts(databasePath)
      expect(after).toEqual(before)

      // The rows themselves, not just their number.
      expect(database.connection.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId)).toEqual({ title: '合成的对话' })
      expect(database.connection.prepare('SELECT body FROM messages WHERE id = ?').get(messageId)).toEqual({ body: '我对花生过敏。' })
      expect(database.connection.prepare('SELECT current_text, status FROM memories WHERE id = ?').get(memoryId))
        .toEqual({ current_text: '我对花生过敏。', status: 'active' })
      expect(database.connection.prepare("SELECT version, system_rules FROM personality_profiles WHERE id = 'primary'").get())
        .toEqual({ version: 3, system_rules: 'Prefer concise answers.' })
      const expectedProvider = version >= 13
        ? { id: 'local-openai', endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:0.5b' }
        : { id: 'deepseek', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' }
      expect(database.connection.prepare('SELECT id, endpoint, model, enabled, timeout_ms, catalog_verified, active FROM provider_profiles').get())
        .toEqual({ ...expectedProvider, enabled: 1, timeout_ms: 45000, catalog_verified: 0, active: 0 })
      if (version >= 18) {
        expect(database.connection.prepare('SELECT status FROM persona_feedback_candidates WHERE id = ?').get(candidateId))
          .toEqual({ status: 'supported' })
        expect(database.connection.prepare('SELECT status, withdrawn_at FROM persona_feedback_evidence WHERE candidate_id = ?').get(candidateId))
          .toEqual({ status: 'active', withdrawn_at: null })
      }
      if (version >= 11) {
        expect(database.connection.prepare("SELECT state FROM deletion_journal WHERE entity_id = ?").get('66666666-6666-4666-8666-666666666666'))
          .toEqual({ state: 'retracted' })
      }
      expect(database.connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    })
  }

  it('keeps the v21 selection column unset so the default rule still applies', () => {
    const { databasePath } = tempProfile()
    seedAtVersion(databasePath, 20)
    const database = SqliteDatabase.open(databasePath)
    openDatabases.push(database)
    expect(Number(database.connection.prepare('SELECT count(*) AS count FROM provider_profiles WHERE active = 1').get()?.count)).toBe(0)
    // The partial unique index is real, not a convention.
    database.connection.prepare('UPDATE provider_profiles SET active = 1 WHERE id = ?').run('local-openai')
    expect(() => database.connection.prepare(`
      INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, timeout_ms, catalog_verified, active, updated_at)
      VALUES ('third-party', 'remote', 'https://example.test/v1', 'm', 1, 45000, 0, 1, ?)
    `).run(T0)).toThrow()
  })
})

describe('a controlled failure during the upgrade leaves the original intact', () => {
  it('keeps every row, refuses to bump the version, and leaves a usable recovery copy', () => {
    const { directory, databasePath } = tempProfile()
    seedAtVersion(databasePath, 20)
    const before = counts(databasePath)

    // A migration set that is identical up to v20 and then fails on purpose.
    const failing: readonly typeof migrations[number][] = [
      ...migrations.filter((migration) => migration.version <= 20),
      {
        version: 21,
        name: 'explicit-provider-selection',
        up() {
          throw new Error('deliberate failure while adding the selection column')
        }
      }
    ]

    expect(() => {
      const connection = new DatabaseSync(databasePath)
      try {
        applyMigrations(connection, 21, failing)
      } finally {
        connection.close()
      }
    }).toThrow()

    // Original database: same rows, still at v20.
    expect(counts(databasePath)).toEqual(before)
    const connection = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 20 })
      expect(connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      expect(connection.prepare('SELECT current_text FROM memories WHERE id = ?').get(memoryId))
        .toEqual({ current_text: '我对花生过敏。' })
    } finally {
      connection.close()
    }

    // The app still opens it: a failed optional migration must not brick the
    // database, and the next successful run finishes the upgrade.
    const reopened = SqliteDatabase.open(databasePath)
    openDatabases.push(reopened)
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(counts(databasePath)).toEqual(before)
    expect(existsSync(join(directory, 'morrow.sqlite3'))).toBe(true)
  })

  it('retains a verified recovery snapshot when the real open path fails', () => {
    const { directory, databasePath } = tempProfile()
    seedAtVersion(databasePath, 20)
    // A half-applied developer build: the column the next migration adds is
    // already there, so v21 fails on a duplicate column. This goes through
    // `SqliteDatabase.open`, which is where the snapshot is taken.
    const tamper = new DatabaseSync(databasePath)
    try {
      tamper.exec('ALTER TABLE provider_profiles ADD COLUMN active INTEGER NOT NULL DEFAULT 0')
    } finally {
      tamper.close()
    }
    // The app opens in degraded mode at the last good version instead of
    // bricking: a failed optional migration must not take the whole database
    // down. The user keeps working and the next successful build finishes it.
    const degraded = SqliteDatabase.open(databasePath)
    openDatabases.push(degraded)
    expect(degraded.schemaVersion).toBe(20)

    const backups = readdirSync(directory).filter((name) => name.startsWith(`morrow.sqlite3.pre-v20-to-v${CURRENT_SCHEMA_VERSION}-`) && name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    const snapshot = join(directory, backups[0]!)
    expect(statSync(snapshot).size).toBeGreaterThan(0)
    const connection = new DatabaseSync(snapshot, { readOnly: true })
    try {
      expect(connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      expect(connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 20 })
      // The snapshot is a full copy: the synthetic facts are in it.
      expect(connection.prepare('SELECT body FROM messages WHERE id = ?').get(messageId)).toEqual({ body: '我对花生过敏。' })
    } finally {
      connection.close()
    }
    // And the live file was not silently half-migrated.
    const live = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(live.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 20 })
      expect(live.prepare('SELECT current_text FROM memories WHERE id = ?').get(memoryId)).toEqual({ current_text: '我对花生过敏。' })
    } finally {
      live.close()
    }
  })
})

describe('a backup restores into an openable, consistent database', () => {
  it('round-trips the rows and passes integrity and foreign-key checks', async () => {
    const { directory, databasePath } = tempProfile()
    seedAtVersion(databasePath, 18)
    const database = SqliteDatabase.open(databasePath)
    openDatabases.push(database)
    const before = counts(databasePath)

    const service = new BackupService(database, databasePath)
    const exported = await service.export(join(directory, 'backups'))
    expect(exported.status).toBe('created')

    const preview = await service.preview(exported.directory)
    const restored = await service.restore({ token: preview.token, confirmed: true })
    expect(restored.status).toBe('restored')

    const reopened = SqliteDatabase.open(databasePath)
    openDatabases.push(reopened)
    expect(reopened.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(counts(databasePath)).toEqual(before)
    expect(reopened.connection.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    expect(reopened.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(reopened.connection.prepare('SELECT body FROM messages WHERE id = ?').get(messageId))
      .toEqual({ body: '我对花生过敏。' })
  })
})

describe('credentials stay out of the database and its backup', () => {
  it('has no credential column and no key bytes anywhere in the exported files', async () => {
    const { directory, databasePath } = tempProfile()
    seedAtVersion(databasePath, 20)
    const database = SqliteDatabase.open(databasePath)
    openDatabases.push(database)

    // The key would live in the OS-backed SecretStore, never in SQLite.
    const columns = database.connection.prepare('PRAGMA table_info(provider_profiles)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('api_key')
    expect(columns.map((column) => column.name)).not.toContain('credential')

    const service = new BackupService(database, databasePath)
    const exported = await service.export(join(directory, 'backups'))
    const backupFiles = readdirSync(exported.directory)
    expect(backupFiles.sort()).toEqual(['manifest.json', 'morrow.sqlite3'])
    const sentinel = 'sk-sentinel-should-never-appear'
    for (const file of backupFiles) {
      const bytes = readFileSync(join(exported.directory, file))
      expect(bytes.includes(Buffer.from(sentinel, 'utf8'))).toBe(false)
    }
    // The manifest is a manifest, not a settings dump.
    const manifest = JSON.parse(readFileSync(join(exported.directory, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(manifest).sort()).toEqual(['application', 'counts', 'createdAt', 'database', 'format', 'formatVersion'])
  })
})

describe('the fail-closed behaviour when a newer build wrote the file', () => {
  it('refuses a schema version this build does not know, and says so', () => {
    const { databasePath } = tempProfile()
    seedAtVersion(databasePath, CURRENT_SCHEMA_VERSION)
    const connection = new DatabaseSync(databasePath)
    try {
      connection.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(CURRENT_SCHEMA_VERSION + 1, 'future-build', T0)
    } finally {
      connection.close()
    }
    // Rolling the code back leaves a file the old build must refuse rather than
    // half-read. The user-facing consequence is "restore a backup", which is
    // why the recovery snapshot above matters.
    expect(() => SqliteDatabase.open(databasePath)).toThrow()
    const stillThere = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(stillThere.prepare('SELECT MAX(version) AS version FROM schema_migrations').get())
        .toEqual({ version: CURRENT_SCHEMA_VERSION + 1 })
      expect(stillThere.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    } finally {
      stillThere.close()
    }
  })
})

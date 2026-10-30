import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations, CURRENT_SCHEMA_VERSION, DEGRADED_OPEN_MINIMUM_VERSION, type Migration } from './migrations'
import { SUPPORTED_GOAL_INTENT } from '../motivation/goals'
import { SqliteDatabase } from './database'
import { isFeelingState } from '../affective-state/feeling'
import { analyzeCognitiveTurn } from '../cognition/cognitive-turn-analyzer'
import { isCognitiveTurnAnalysis } from '../cognition/cognition'

const timestamp = '2026-10-24T00:00:00.000Z'

let directory = ''

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('versioned local SQLite storage', () => {
  it('initializes an empty data directory and records the current schema version', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-empty-db-'))
    const path = join(directory, 'profile', 'morrow.sqlite3')
    const database = SqliteDatabase.open(path)
    expect(database.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(database.cognitivePersistenceAvailable).toBe(true)
    const initialStateJson = String(database.connection.prepare('SELECT state_json FROM cognitive_feeling_state WHERE id = 1').get()?.state_json ?? '')
    expect(isFeelingState(JSON.parse(initialStateJson))).toBe(true)
    expect(JSON.parse(initialStateJson)).toMatchObject({
      values: { valence: 0, activation: 0, tension: 0 },
      attention: { explorationPriority: 0, sourceEventId: null, updatedAt: null, evidenceRefs: [] }
    })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM memories').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    database.close()
  })

  it('migrates a v1 database without losing its records or falsely changing their source', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-upgrade-db-'))
    const path = join(directory, 'morrow.sqlite3')
    const connection = new DatabaseSync(path)
    expect(applyMigrations(connection, 1)).toBe(1)
    connection.prepare(`
      INSERT INTO memories(id, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      '06d9f3b8-941d-49c6-8214-3b2324c40791',
      'Legacy user-entered text.',
      'active',
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T01:00:00.000Z'
    )
    expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)
    expect(connection.prepare('SELECT original_text, current_text, source_category, status, revision FROM memories').get())
      .toEqual({
        original_text: 'Legacy user-entered text.',
        current_text: 'Legacy user-entered text.',
        source_category: 'user_explicit_input',
        status: 'active',
        revision: 1
      })
    expect(connection.prepare('SELECT revision, previous_revision, change_type FROM memory_revisions').get())
      .toEqual({ revision: 1, previous_revision: null, change_type: 'created' })
    expect(connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => ({ version: index + 1 })))
    connection.close()
    const reopened = SqliteDatabase.open(path)
    expect(reopened.connection.prepare('SELECT current_text FROM memories').get())
      .toEqual({ current_text: 'Legacy user-entered text.' })
    reopened.close()
  })

  it('upgrades v8 data without rewriting it and removes the recovery copy after a valid startup', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v8-backup-'))
    const path = join(directory, 'morrow.sqlite3')
    const legacy = new DatabaseSync(path)
    expect(applyMigrations(legacy, 8)).toBe(8)
    legacy.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('11111111-1111-4111-8111-111111111111', 'Existing conversation', timestamp, timestamp)
    legacy.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'user', 'Existing private message.', timestamp, 1, '33333333-3333-4333-8333-333333333333')
    legacy.close()

    const upgraded = SqliteDatabase.open(path)
    expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(upgraded.connection.prepare('SELECT body FROM messages').get()).toEqual({ body: 'Existing private message.' })
    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    upgraded.close()

    const backupNames = readdirSync(directory).filter((name) => name.startsWith(`morrow.sqlite3.pre-v8-to-v${CURRENT_SCHEMA_VERSION}-`) && name.endsWith('.bak'))
    expect(backupNames).toEqual([])
  })

  it('upgrades v9 cognitive observations and settings without rewriting them, and initializes baseline feeling state', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v9-backup-'))
    const path = join(directory, 'morrow.sqlite3')
    const legacy = new DatabaseSync(path, { enableForeignKeyConstraints: true })
    legacy.exec('PRAGMA foreign_keys = ON')
    expect(applyMigrations(legacy, 9)).toBe(9)

    const conversationId = '11111111-1111-4111-8111-111111111111'
    const messageId = '22222222-2222-4222-8222-222222222222'
    legacy.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, 'Existing cognitive conversation', timestamp, timestamp)
    legacy.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(messageId, conversationId, 'user', 'What does this mean?', timestamp, 1, '33333333-3333-4333-8333-333333333333')
    const legacyAnalysis = { ...analyzeCognitiveTurn('What does this mean?', [], messageId), analyzerVersion: 'rules-v1' as const }
    const analysisJson = JSON.stringify(legacyAnalysis)
    legacy.prepare('INSERT INTO cognitive_core_settings(id, enabled, updated_at) VALUES (1, 1, ?)').run(timestamp)
    legacy.prepare(`
      INSERT INTO cognitive_turn_observations(
        conversation_id, source_message_id, attempt, analyzed_at, schema_version, analyzer_version, analysis_json
      ) VALUES (?, ?, 1, ?, 1, 'rules-v1', ?)
    `).run(conversationId, messageId, timestamp, analysisJson)
    legacy.close()

    const upgraded = SqliteDatabase.open(path)
    try {
      expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(upgraded.cognitivePersistenceAvailable).toBe(true)
      expect(upgraded.connection.prepare('SELECT enabled, updated_at FROM cognitive_core_settings WHERE id = 1').get())
        .toEqual({ enabled: 1, updated_at: timestamp })
      const observation = upgraded.connection.prepare(`
        SELECT schema_version, analyzer_version, analysis_json
        FROM cognitive_turn_observations WHERE conversation_id = ? AND source_message_id = ? AND attempt = 1
      `).get(conversationId, messageId) as { schema_version: number; analyzer_version: string; analysis_json: string } | undefined
      expect(observation).toEqual({ schema_version: 1, analyzer_version: 'rules-v1', analysis_json: analysisJson })
      expect(isCognitiveTurnAnalysis(JSON.parse(observation!.analysis_json))).toBe(true)
      const stateJson = String(upgraded.connection.prepare('SELECT state_json FROM cognitive_feeling_state WHERE id = 1').get()?.state_json ?? '')
      expect(isFeelingState(JSON.parse(stateJson))).toBe(true)
      expect(JSON.parse(stateJson)).toMatchObject({ revision: 0, values: { valence: 0, activation: 0, tension: 0 } })
      expect(upgraded.connection.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_events').get()).toEqual({ count: 0 })
      expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      upgraded.close()
    }

    expect(readdirSync(directory).filter((name) => name.startsWith(`morrow.sqlite3.pre-v9-to-v${CURRENT_SCHEMA_VERSION}-`) && name.endsWith('.bak')))
      .toEqual([])
  })

  it('retains a verified recovery snapshot when an existing migration cannot be applied', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v7-backup-'))
    const path = join(directory, 'morrow.sqlite3')
    const legacy = new DatabaseSync(path)
    expect(applyMigrations(legacy, 7)).toBe(7)
    legacy.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('11111111-1111-4111-8111-111111111111', 'Existing conversation', timestamp, timestamp)
    legacy.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'user', 'Existing private message.', timestamp, 1, '33333333-3333-4333-8333-333333333333')
    legacy.exec('CREATE TABLE personality_revisions (sentinel TEXT PRIMARY KEY) STRICT')
    legacy.close()

    expect(() => SqliteDatabase.open(path)).toThrow('Local storage could not be opened.')
    const backupNames = readdirSync(directory).filter((name) => name.startsWith(`morrow.sqlite3.pre-v7-to-v${CURRENT_SCHEMA_VERSION}-`) && name.endsWith('.bak'))
    expect(backupNames).toHaveLength(1)
    const backupPath = join(directory, backupNames[0]!)
    expect(existsSync(backupPath)).toBe(true)

    const original = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true })
    try {
      expect(original.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 7 })
      expect(original.prepare('SELECT body FROM messages').get()).toEqual({ body: 'Existing private message.' })
    } finally {
      original.close()
    }

    const backup = new DatabaseSync(backupPath, { readOnly: true, enableForeignKeyConstraints: true })
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(backup.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 7 })
      expect(backup.prepare('SELECT body FROM messages').get()).toEqual({ body: 'Existing private message.' })
    } finally {
      backup.close()
    }
  })

  it('keeps the app in the v9 core-chat fallback if the feeling migration fails', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v9-fallback-'))
    const path = join(directory, 'morrow.sqlite3')
    const legacy = new DatabaseSync(path)
    expect(applyMigrations(legacy, 8)).toBe(8)
    legacy.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('11111111-1111-4111-8111-111111111111', 'Existing conversation', timestamp, timestamp)
    legacy.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'user', 'Existing private message.', timestamp, 1, '33333333-3333-4333-8333-333333333333')
    legacy.exec('CREATE TABLE cognitive_feeling_state (id INTEGER PRIMARY KEY)')
    legacy.close()

    const degraded = SqliteDatabase.open(path)
    // Migration v10 fails on the poisoned feeling table, so the database stays
    // at v9 — the oldest schema in the open fallback window — regardless of how
    // many migrations exist after v10.
    expect(degraded.schemaVersion).toBe(9)
    expect(degraded.schemaVersion).toBe(DEGRADED_OPEN_MINIMUM_VERSION)
    expect(degraded.cognitivePersistenceAvailable).toBe(false)
    expect(degraded.connection.prepare('SELECT body FROM messages').get()).toEqual({ body: 'Existing private message.' })
    expect(degraded.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cognitive_feeling_events'").get()).toBeUndefined()
    expect(readdirSync(directory).some((name) => name.startsWith(`morrow.sqlite3.pre-v8-to-v${CURRENT_SCHEMA_VERSION}-`) && name.endsWith('.bak'))).toBe(true)
    degraded.close()
  })


  it('upgrades an existing v3 goal database without changing goal data and keeps reminder consent empty', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v3-upgrade-db-'))
    const path = join(directory, 'morrow.sqlite3')
    const connection = new DatabaseSync(path)
    expect(applyMigrations(connection, 3)).toBe(3)
    connection.prepare(`
      INSERT INTO goals(id, intent, success_criterion, constraints_text, source_category, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '06d9f3b8-941d-49c6-8214-3b2324c40791',
      SUPPORTED_GOAL_INTENT,
      'active_memory_count_matches_database',
      '只读取当前有效记忆数量，不修改或删除数据，不访问网络。',
      'user_explicit_input',
      'active',
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T01:00:00.000Z'
    )
    connection.close()

    const upgraded = SqliteDatabase.open(path)
    expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(upgraded.connection.prepare('SELECT intent, status FROM goals').get()).toEqual({
      intent: SUPPORTED_GOAL_INTENT,
      status: 'active'
    })
    expect(upgraded.connection.prepare('SELECT count(*) AS count FROM reminder_settings').get()).toEqual({ count: 0 })
    expect(upgraded.connection.prepare('SELECT id, sensitivity FROM memories').all()).toEqual([])
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('conversations', 'messages', 'provider_profiles', 'personality_profiles', 'memory_suggestions', 'personality_revisions') ORDER BY name").all())
      .toEqual([
        { name: 'conversations' },
        { name: 'memory_suggestions' },
        { name: 'messages' },
        { name: 'personality_profiles' },
        { name: 'personality_revisions' },
        { name: 'provider_profiles' }
      ])

    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    upgraded.close()
  })

  it('rolls back a failing migration and does not record it as applied', () => {
    const connection = new DatabaseSync(':memory:')
    const failingMigration: readonly Migration[] = [{
      version: 1,
      name: 'deliberate-failure',
      up(database) {
        database.exec('CREATE TABLE should_rollback (value TEXT) STRICT')
        throw new Error('internal path and content are intentionally hidden')
      }
    }]
    expect(() => applyMigrations(connection, 1, failingMigration)).toThrow('Database migration failed.')
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback'").get())
      .toBeUndefined()
    expect(connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 0 })
    connection.close()
  })

  it('refuses a database newer than this application without altering its version', () => {
    const connection = new DatabaseSync(':memory:')
    connection.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations(version, name, applied_at)
      VALUES (${CURRENT_SCHEMA_VERSION + 1}, 'future', '2026-10-20T00:00:00.000Z');
    `)
    expect(() => applyMigrations(connection)).toThrow('Unsupported database schema version.')
    expect(connection.prepare('SELECT version, name FROM schema_migrations').get())
      .toEqual({ version: CURRENT_SCHEMA_VERSION + 1, name: 'future' })
    connection.close()
  })
})

describe('v18 reflection-summary privacy rewrite', () => {
  it('rewrites a legacy reflection summary without deleting the row or its state', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v18-'))
    const path = join(directory, 'morrow.sqlite3')
    const connection = new DatabaseSync(path)
    try {
      applyMigrations(connection, 17)
      const id = '11111111-1111-4111-8111-111111111111'
      const legacySummary = '以下关于自己的判断仍是未经确认的推断，等待用户澄清：「我对青霉素严重过敏」'
      connection.prepare(`
        INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, conversation_id, detail_json, created_at, updated_at, completed_at)
        VALUES (?, ?, 'reflection', 'consistency_note', ?, 45, 'open', NULL, ?, ?, ?, NULL)
      `).run(
        id,
        'reflection:consistency_note:0123456789abcdef',
        legacySummary,
        JSON.stringify({ runId: '22222222-2222-4222-8222-222222222222', statementDigest: '0123456789abcdef', extra: '我对青霉素严重过敏' }),
        timestamp,
        timestamp
      )

      expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)

      const row = connection.prepare('SELECT * FROM cognitive_pending_items WHERE id = ?').get(id) as Record<string, unknown>
      // The row survives with its identity and workflow state intact.
      expect(row.id).toBe(id)
      expect(row.status).toBe('open')
      expect(row.priority).toBe(45)
      expect(row.created_at).toBe(timestamp)
      expect(row.dedupe_key).toBe('reflection:consistency_note:0123456789abcdef')
      // The quoted text is gone from both columns that could carry it.
      const serialized = JSON.stringify(row)
      expect(serialized).not.toContain('青霉素')
      expect(row.summary).toBe('反思发现存在尚未确认的自我判断，等待用户澄清。')
      expect(JSON.parse(String(row.detail_json))).toEqual({
        runId: '22222222-2222-4222-8222-222222222222',
        statementDigest: '0123456789abcdef',
        summaryPolicy: 'category_template_v1'
      })
      // Exactly one row: the rewrite is an update, not a delete-and-insert.
      expect(connection.prepare('SELECT COUNT(*) AS count FROM cognitive_pending_items').get()).toEqual({ count: 1 })
    } finally {
      connection.close()
    }
  })

  it('leaves non-reflection items untouched', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v18-conflict-'))
    const connection = new DatabaseSync(join(directory, 'morrow.sqlite3'))
    try {
      applyMigrations(connection, 17)
      const id = '33333333-3333-4333-8333-333333333333'
      const summary = '已保存的记录在「residence」上互相矛盾，尚未确认哪一条是当前状态。'
      connection.prepare(`
        INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, conversation_id, detail_json, created_at, updated_at, completed_at)
        VALUES (?, 'conflict:residence:a,b', 'conflict', 'conflict_residence', ?, 70, 'open', NULL, '{}', ?, ?, NULL)
      `).run(id, summary, timestamp, timestamp)

      applyMigrations(connection)

      const row = connection.prepare('SELECT summary FROM cognitive_pending_items WHERE id = ?').get(id) as { summary: string }
      expect(row.summary).toBe(summary)
    } finally {
      connection.close()
    }
  })
})

describe('derived-data deletion boundaries', () => {
  it('deletes source-linked self-model and interest rows plus conversation-scoped continuity records', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-derived-delete-'))
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    const db = database.connection
    const conversationId = '11111111-1111-4111-8111-111111111111'
    const messageId = '22222222-2222-4222-8222-222222222222'
    const turnId = '33333333-3333-4333-8333-333333333333'
    const assistantId = '44444444-4444-4444-8444-444444444444'
    const selfModelId = '55555555-5555-4555-8555-555555555555'
    const interestId = '66666666-6666-4666-8666-666666666666'
    const pendingId = '77777777-7777-4777-8777-777777777777'

    try {
      db.prepare('INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(conversationId, 'delete me', timestamp, timestamp)
      db.prepare('INSERT INTO messages(id, conversation_id, role, body, created_at, sequence, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(messageId, conversationId, 'user', 'I like coffee.', timestamp, 1, turnId)
      db.prepare(`
        INSERT INTO self_model_entries(id, kind, statement, status, confidence, source_message_id, conversation_id, superseded_by, created_at, updated_at)
        VALUES (?, 'fact', 'I like coffee.', 'active', 55, ?, ?, NULL, ?, ?)
      `).run(selfModelId, messageId, conversationId, timestamp, timestamp)
      db.prepare(`
        INSERT INTO interests(id, label, status, evidence_count, conversation_count, strength, confidence, source_message_id, conversation_id, first_seen_at, last_seen_at, updated_at, terms_json)
        VALUES (?, 'coffee', 'candidate', 1, 1, 0.2, 40, ?, ?, ?, ?, ?, '[]')
      `).run(interestId, messageId, conversationId, timestamp, timestamp, timestamp)
      db.prepare('INSERT INTO cognitive_turn_contexts(turn_id, conversation_id, status, recorded_at, payload_json) VALUES (?, ?, ?, ?, ?)')
        .run(turnId, conversationId, 'succeeded', timestamp, '{}')
      db.prepare(`
        INSERT INTO cognitive_pending_items(id, dedupe_key, source, kind, summary, priority, status, conversation_id, detail_json, created_at, updated_at, completed_at)
        VALUES (?, 'interest:coffee', 'interest', 'interest_candidate', 'Candidate interest', 20, 'open', ?, '{}', ?, ?, NULL)
      `).run(pendingId, conversationId, timestamp, timestamp)
      db.prepare('INSERT INTO cognitive_turn_finalizations(turn_id, conversation_id, user_message_id, assistant_message_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(turnId, conversationId, messageId, assistantId, '{}', timestamp)

      db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)

      for (const table of ['messages', 'self_model_entries', 'interests', 'cognitive_turn_contexts', 'cognitive_pending_items', 'cognitive_turn_finalizations']) {
        expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
      }
    } finally {
      database.close()
    }
  })
})

describe('foreign implementation-line databases', () => {  it('fails closed without writing when migration names do not match this application', () => {
    const directory = mkdtempSync(join(tmpdir(), 'morrow-foreign-schema-'))
    try {
      const path = join(directory, 'morrow.sqlite3')
      const foreign = new DatabaseSync(path)
      // A different implementation line can reuse version numbers 1-5 with
      // entirely different migration names and table shapes (v0.1.0 did).
      foreign.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
        CREATE TABLE memories (id TEXT PRIMARY KEY, kind TEXT, claim TEXT) STRICT;
        INSERT INTO schema_migrations(version, name, applied_at) VALUES
          (1, 'conversations-and-messages', '2026-10-21T10:00:00.000Z'),
          (2, 'evidence-backed-memory-and-revisions', '2026-10-21T10:00:01.000Z'),
          (3, 'memory-supersession-lineage', '2026-10-21T10:00:02.000Z'),
          (4, 'stable-message-order', '2026-10-21T10:00:03.000Z'),
          (5, 'scoped-memory-search', '2026-10-21T10:00:04.000Z');
      `)
      foreign.close()

      expect(() => SqliteDatabase.open(path)).toThrow('Local storage could not be opened.')

      const untouched = new DatabaseSync(path, { readOnly: true })
      const version = Number(untouched.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version)
      const columns = untouched.prepare('PRAGMA table_info(memories)').all().map((row) => row.name)
      untouched.close()
      expect(version).toBe(5)
      expect(columns).toEqual(['id', 'kind', 'claim'])
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('v25 memory-backed interest evidence', () => {
  it('upgrades a v24 ledger without losing rows and invalidates on retract afterwards', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-v25-'))
    const path = join(directory, 'morrow.sqlite3')
    const connection = new DatabaseSync(path)
    try {
      connection.exec('PRAGMA foreign_keys = ON')
      // Build a v24 database, then write one memory-backed evidence row that the
      // upgrade must keep (it predates the revision column).
      expect(applyMigrations(connection, 24)).toBe(24)
      connection.prepare(
        'INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('11111111-1111-4111-8111-111111111111', 'topic', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z')
      connection.prepare(
        'INSERT INTO memories(id, original_text, current_text, source_category, status, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('44444444-4444-4444-8444-444444444444', '我在学咖啡拉花。', '我在学咖啡拉花。', 'user_explicit_input', 'active', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z', 1)
      connection.prepare(
        'INSERT INTO interests(id, label, status, evidence_count, conversation_count, strength, confidence, source_message_id, conversation_id, first_seen_at, last_seen_at, updated_at, terms_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('55555555-5555-4555-8555-555555555555', '咖啡拉花', 'candidate', 1, 1, 0.5, 40, '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z', '2026-10-29T09:00:00.000Z', '[]')
      connection.prepare(
        'INSERT INTO interest_evidence(interest_id, evidence_ref, evidence_kind, conversation_id, polarity, match_score, match_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', 'memory', '11111111-1111-4111-8111-111111111111', 'support', 0.9, 'same_topic', '2026-10-29T09:00:00.000Z')

      expect(applyMigrations(connection)).toBe(CURRENT_SCHEMA_VERSION)

      // The upgrade keeps the row and marks the revision as unknown (NULL).
      const kept = connection.prepare('SELECT evidence_ref, evidence_revision FROM interest_evidence').all()
      expect(kept).toHaveLength(1)
      expect(kept[0]).toMatchObject({ evidence_ref: '44444444-4444-4444-8444-444444444444', evidence_revision: null })

      // Retracting the memory now clears it, which the v24 schema did not do.
      connection.prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?')
        .run('retracted', '2026-10-29T10:00:00.000Z', '44444444-4444-4444-8444-444444444444')
      expect(connection.prepare('SELECT COUNT(*) AS count FROM interest_evidence').get()).toEqual({ count: 0 })
    } finally {
      connection.close()
    }
  })
})

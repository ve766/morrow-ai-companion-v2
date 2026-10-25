import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'

const profile = resolve(process.argv[2] ?? '')
const manifest = JSON.parse(readFileSync(join(profile, 'morrow-alpha-smoke-manifest.json'), 'utf8'))

function findDatabase(directory, depth = 0) {
  if (depth > 8) return undefined
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === 'morrow.sqlite3') return path
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !['node_modules', 'install'].includes(entry.name)) {
      const found = findDatabase(join(directory, entry.name), depth + 1)
      if (found) return found
    }
  }
  return undefined
}

const databasePath = findDatabase(profile)
assert.ok(databasePath, 'The isolated user profile must retain the Morrow database.')
const database = new DatabaseSync(databasePath, { readOnly: true, enableForeignKeyConstraints: true })
try {
  const integrity = database.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)
  assert.deepEqual(integrity, ['ok'], 'The Morrow database must pass SQLite integrity_check.')
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [], 'The Morrow database must have no broken foreign keys.')

  const schemaVersion = Number(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0)
  assert.equal(schemaVersion, manifest.schemaVersion, 'The installed update must preserve the database schema version.')

  const settings = database.prepare('SELECT enabled, updated_at FROM cognitive_core_settings WHERE id = 1').get()
  assert.equal(settings?.enabled, 0, 'The explicit disabled setting must persist.')
  assert.ok(settings?.updated_at, 'The explicit disabled setting must have a persisted timestamp.')

  const stateRow = database.prepare('SELECT state_json, revision, dirty FROM cognitive_feeling_state WHERE id = 1').get()
  const state = JSON.parse(stateRow?.state_json ?? 'null')
  assert.equal(stateRow?.revision, 0, 'Cleared state must remain at revision zero.')
  assert.equal(stateRow?.dirty, 0, 'Cleared state must not require replay.')
  assert.equal(state?.revision, 0, 'Serialized cleared state must remain at revision zero.')
  assert.deepEqual(state?.values, { valence: 0, activation: 0, tension: 0 }, 'Cleared feeling values must remain at baseline.')
  assert.deepEqual(state?.attention, { explorationPriority: 0, sourceEventId: null, updatedAt: null, evidenceRefs: [] }, 'Cleared attention state must remain at baseline.')
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_events').get()?.count ?? 0), 0, 'Cleared feeling events must not return after installation.')
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM cognitive_feeling_revisions').get()?.count ?? 0), 0, 'Cleared state revisions must not return after installation.')
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM cognitive_turn_observations').get()?.count ?? 0), 0, 'Cleared turn observations must not return after installation.')
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'morrow_alpha_smoke_reject_cognitive_clear'").get()?.count ?? 0), 0, 'No smoke failure trigger may remain in the profile.')

  const conversations = database.prepare('SELECT id FROM conversations ORDER BY id').all()
  assert.equal(conversations.length, 1, 'Conversation deletion must leave the retained conversation intact.')
  assert.equal(conversations[0]?.id, manifest.conversationId, 'The original conversation must survive cognitive clearing and uninstall.')
  const messages = database.prepare('SELECT role, body FROM messages WHERE conversation_id = ? ORDER BY sequence').all(manifest.conversationId)
  assert.equal(messages.length, 3, 'The retained conversation must keep all three local smoke messages.')
  assert.ok(messages.some((message) => message.role === 'user' && message.body === manifest.cognitiveMessage), "The retained conversation must preserve the original user message after cognitive clearing.")

  const memories = database.prepare("SELECT current_text, status FROM memories WHERE status = 'active'").all()
  assert.equal(memories.length, 1, 'The explicitly retained memory must survive update and uninstall.')
  assert.equal(memories[0]?.current_text, manifest.persistentText, 'The retained memory text must remain unchanged.')

  const personality = database.prepare("SELECT version, system_rules FROM personality_profiles WHERE id = 'primary'").get()
  assert.equal(personality?.version, 2, 'The user-controlled personality version must survive update and uninstall.')
  assert.equal(personality?.system_rules, manifest.personalityMarker, 'The user-controlled personality must remain unchanged.')

  console.log(JSON.stringify({
    passed: true,
    schemaVersion,
    integrity: integrity[0],
    foreignKeyViolations: 0,
    retainedConversations: conversations.length,
    retainedMessages: messages.length,
    retainedMemories: memories.length,
    personalityVersion: personality.version,
    cognitiveDisabled: settings.enabled === 0,
    cognitiveEvents: 0,
    cognitiveObservations: 0,
    cognitiveRevisions: 0
  }))
} finally {
  database.close()
}

import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { analyzeCognitiveTurn } from '../src/cognition/cognitive-turn-analyzer.ts'
import { createCognitiveFeelingEvent } from '../src/affective-state/cognitive-feeling-engine.ts'
import { CognitiveFeelingService } from '../src/affective-state/cognitive-feeling-service.ts'
import { ConversationService } from '../src/conversation/conversation-service.ts'
import { SqliteDatabase } from '../src/persistence/database.ts'
import { SqliteConversationRepository } from '../src/persistence/conversation-repository.ts'
import { isCognitiveUuid } from '../src/cognition/cognition.ts'

const [action, profileArg, conversationIdArg, markerArg] = process.argv.slice(2)
const profile = resolve(profileArg ?? '')
const clearFailureTrigger = 'morrow_alpha_smoke_reject_cognitive_clear'

function findDatabase(directory: string, depth = 0): string | undefined {
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

function summarize(database: SqliteDatabase) {
  return {
    schemaVersion: database.schemaVersion,
    conversations: Number(database.connection.prepare('SELECT COUNT(*) AS count FROM conversations').get()?.count ?? 0),
    messages: Number(database.connection.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count ?? 0),
    observations: database.connection.prepare('SELECT conversation_id, COUNT(*) AS count FROM cognitive_turn_observations GROUP BY conversation_id ORDER BY conversation_id').all(),
    events: database.connection.prepare('SELECT conversation_id, COUNT(*) AS count FROM cognitive_feeling_events GROUP BY conversation_id ORDER BY conversation_id').all(),
    state: database.connection.prepare('SELECT revision, dirty FROM cognitive_feeling_state WHERE id = 1').get()
  }
}

function seed(database: SqliteDatabase, conversationId: string, marker: string) {
  if (!database.cognitivePersistenceAvailable || !isCognitiveUuid(conversationId) || !marker || marker.length > 120) {
    throw new Error('Invalid alpha smoke seed request.')
  }
  const enabled = database.connection.prepare('SELECT enabled FROM cognitive_core_settings WHERE id = 1').get()?.enabled
  if (enabled !== 1) throw new Error('Cognitive settings are not enabled for the smoke seed.')
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const current = conversations.read(conversationId)
  if (current.messages.length !== 0) throw new Error('The alpha smoke conversation is not empty.')

  const priorAssistantId = randomUUID()
  const priorTurnId = randomUUID()
  const priorAssistant = conversations.appendMessage(
    conversationId,
    'assistant',
    '本地验收先前回复。',
    priorTurnId,
    { messageId: priorAssistantId }
  ).messages.find((message) => message.id === priorAssistantId)
  if (!priorAssistant) throw new Error('Could not create the local smoke context.')

  const sourceMessageId = randomUUID()
  const turnId = randomUUID()
  const userText = `${marker}: 你的回答很有帮助。`
  const analyzedAt = new Date().toISOString()
  const history = [{ id: priorAssistant.id, role: 'assistant' as const, body: priorAssistant.body }]
  const analysis = analyzeCognitiveTurn(userText, history, sourceMessageId)
  const observation = { attempt: 1, analyzedAt, analysis }
  conversations.appendMessage(conversationId, 'user', userText, turnId, {
    messageId: sourceMessageId,
    cognitiveObservation: observation
  })
  const assistantMessageId = randomUUID()
  const assistant = conversations.appendMessage(
    conversationId,
    'assistant',
    '已收到这条本地验收样例。',
    turnId,
    { messageId: assistantMessageId }
  ).messages.find((message) => message.id === assistantMessageId)
  if (!assistant) throw new Error('Could not complete the local smoke turn.')

  const event = createCognitiveFeelingEvent({
    analysis,
    content: userText,
    history,
    conversationId,
    sourceMessageId,
    idempotencyKey: turnId,
    occurredAt: analyzedAt
  })
  if (!event || event.type !== 'positive_feedback') throw new Error('The local smoke turn did not create its expected event.')
  const recorded = new CognitiveFeelingService(database, () => analyzedAt).recordCompletedTurn(event, assistant.id, analyzedAt)
  if (!recorded) throw new Error('The local smoke event was unexpectedly deduplicated.')
  const dirtied = database.connection.prepare('UPDATE cognitive_feeling_state SET dirty = 1 WHERE id = 1').run()
  if (dirtied.changes !== 1) throw new Error('Could not stage cognitive-state replay for restart verification.')
  return { conversationId, sourceMessageId, userText, schemaVersion: database.schemaVersion }
}

function main() {
  const databasePath = findDatabase(profile)
  if (!databasePath) throw new Error('The isolated smoke profile has no Morrow database.')
  const database = SqliteDatabase.open(databasePath)
  try {
    if (action === 'seed') {
      console.log(JSON.stringify(seed(database, conversationIdArg ?? '', markerArg ?? '')))
      return
    }
    if (action === 'inject-clear-failure') {
      database.connection.exec(`CREATE TRIGGER ${clearFailureTrigger} BEFORE DELETE ON cognitive_turn_observations BEGIN SELECT RAISE(ABORT, 'smoke'); END`)
      console.log(JSON.stringify({ injected: true }))
      return
    }
    if (action === 'drop-clear-failure') {
      database.connection.exec(`DROP TRIGGER IF EXISTS ${clearFailureTrigger}`)
      console.log(JSON.stringify({ dropped: true }))
      return
    }
    if (action === 'inspect') {
      console.log(JSON.stringify(summarize(database)))
      return
    }
    throw new Error('Unknown alpha smoke action.')
  } finally {
    database.close()
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Alpha smoke fixture failed.')
  process.exitCode = 1
}

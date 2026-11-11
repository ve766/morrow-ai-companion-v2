import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { EventLogService } from '../persistence/event-log'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import { createOnnxSemanticEncoder } from '../memory/retrieval/onnx-semantic-encoder'
import type { SemanticEncoder } from '../memory/retrieval/retrieval-semantic'

// Documents two known retrieval failures end to end.
//
// The point is to prove what the model actually receives, not what the algorithm
// intended: in both cases the relevant memory is in the database, is the most
// relevant one available, and still does not reach the request. If a later
// change fixes either case, these assertions will fail and the documentation
// must be updated — that is deliberate.

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const MODEL_DIRECTORY = resolve(process.cwd(), '.models')
const hasRealModel = existsSync(join(MODEL_DIRECTORY, MODEL_ID))

const directories: string[] = []
const databases: SqliteDatabase[] = []

function sseResponse(): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: 'ok' } }] })}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function approve(preview: ProviderConsentPreview): ProviderConsent {
  const approvedAt = new Date()
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('The global network path is forbidden in this test.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const database of databases.splice(0)) {
    try { database.close() } catch { /* already closed */ }
  }
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

async function askWith(
  encoder: SemanticEncoder | undefined,
  memories: Array<{ text: string; sensitivity?: 'normal' | 'personal' | 'sensitive' }>,
  question: string
): Promise<{ system: string; decision: { algorithm: string; selected: number; applied: boolean } }> {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-c2-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const memoriesService = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, new EventLogService(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = new MemorySecretStore()
  let captured: { system: string; decision: { algorithm: string; selected: number; applied: boolean } } | undefined

  const companion = new CompanionService({
    database,
    memories: memoriesService,
    conversations,
    secrets,
    authorize: async (preview) => approve(preview),
    ...(encoder ? { semanticEncoder: encoder } : {}),
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      const system = payload.messages.find((message) => message.role === 'system')?.content ?? ''
      const row = database.connection
        .prepare("SELECT payload_json FROM event_journal WHERE event_type = 'retrieval.decision' ORDER BY rowid DESC LIMIT 1")
        .get() as { payload_json: string } | undefined
      const parsed = row ? JSON.parse(row.payload_json) as { algorithm: string; selected: number; semantic: { applied: boolean } } : undefined
      captured = {
        system,
        decision: {
          algorithm: parsed?.algorithm ?? '',
          selected: parsed?.selected ?? -1,
          applied: parsed?.semantic.applied ?? false
        }
      }
      return sseResponse()
    })
  })

  try {
    companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-only-invalid-provider-key' })
    for (const memory of memories) memoriesService.create(memory.text, memory.sensitivity ?? 'personal')
    const conversationId = companion.createConversation().id
    await companion.sendChat({ conversationId, requestId: randomUUID(), content: question, includeSensitive: false }, () => undefined)
  } finally {
    companion.shutdown()
  }
  if (!captured) throw new Error('No provider request was dispatched.')
  return captured
}

describe.skipIf(!hasRealModel)('known retrieval failures, end to end', () => {
  let encoder: SemanticEncoder
  beforeEach(async () => {
    encoder = await createOnnxSemanticEncoder({ modelId: MODEL_ID, cacheDirectory: MODEL_DIRECTORY })
  })

  it('does not put the savings goal into the request for a purchase question', async () => {
    const { system, decision } = await askWith(encoder, [
      { text: 'I am saving for a house deposit.' },
      { text: 'My office plant needs repotting.' }
    ], 'Should I buy this expensive watch?')

    expect(decision.algorithm).toBe('memory-retrieval-v3-hybrid')
    expect(decision.applied).toBe(true)
    // Cosine is 0.056, far below the 0.28 candidate floor: the association is a
    // pragmatic inference, not a distributional similarity.
    expect(decision.selected).toBe(0)
    expect(system).toContain('"memories":[]')
    expect(system).not.toContain('house deposit')
  })

  it('does not put the hobby memory into the request for a Chinese hobby question', async () => {
    const { system, decision } = await askWith(encoder, [
      { text: 'I collect vinyl records.' },
      { text: 'My commute takes forty minutes.' }
    ], '我有什么爱好？')

    expect(decision.applied).toBe(true)
    // Cosine is 0.246 against a 0.28 floor. The ordering would have been right
    // (0.246 vs 0.050), so this one is a threshold boundary, not a ranking bug.
    expect(decision.selected).toBe(0)
    expect(system).toContain('"memories":[]')
    expect(system).not.toContain('vinyl')
  })

  it('does put the corrected memory into the request even though the replaced one is more similar', async () => {
    // Contrast case: here the guard must hold, and it does.
    const directory = mkdtempSync(join(tmpdir(), 'morrow-c2-guard-'))
    directories.push(directory)
    const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
    databases.push(database)
    const memoriesService = new MemoryService(new SqliteMemoryRepository(database))
    const conversations = new ConversationService(new SqliteConversationRepository(database))
    const secrets = new MemorySecretStore()
    let system = ''
    const companion = new CompanionService({
      database,
      memories: memoriesService,
      conversations,
      secrets,
      authorize: async (preview) => approve(preview),
      providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
        system = payload.messages.find((message) => message.role === 'system')?.content ?? ''
        return sseResponse()
      })
    })
    try {
      companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'offline-only-invalid-provider-key' })
      const original = memoriesService.create('I drink two coffees a day.', 'personal')
      memoriesService.correct(original.id, 'I stopped drinking coffee.')
      memoriesService.create('I drink two coffees a day.', 'personal')
      const conversationId = companion.createConversation().id
      await companion.sendChat({ conversationId, requestId: randomUUID(), content: 'Do I still drink coffee?', includeSensitive: false }, () => undefined)
    } finally {
      companion.shutdown()
    }
    expect(system).toContain('I stopped drinking coffee')
    expect(system).not.toContain('two coffees a day')
  })
})

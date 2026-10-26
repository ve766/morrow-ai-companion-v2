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
import { MemorySecretStore, type SecretStore } from '../security/secrets'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import { createOnnxSemanticEncoder } from '../memory/retrieval/onnx-semantic-encoder'
import type { SemanticEncoder } from '../memory/retrieval/retrieval-semantic'

// Phase-5 closed loop for semantic retrieval.
//
// Every assertion reads the dispatched HTTP body. A test that only inspects the
// database cannot tell whether the model ever saw the memory.
//
// Two layers:
//  - a hand-built encoder proves the *plumbing* (signals reach the request,
//    failure degrades to lexical) and runs everywhere;
//  - the real ONNX model proves the *semantics*, and is skipped when the model
//    files are not present locally. It is never silently replaced by a stub.

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const MODEL_DIRECTORY = resolve(process.cwd(), '.models')
const hasRealModel = existsSync(join(MODEL_DIRECTORY, MODEL_ID))

const directories: string[] = []
const databases: SqliteDatabase[] = []
const credential = 'offline-only-invalid-provider-key'

interface CapturedRequest {
  system: string
  user: string
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
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

interface Stack {
  database: SqliteDatabase
  memories: MemoryService
  companion: CompanionService
  conversationId: string
  requests: CapturedRequest[]
  close: () => void
}

function buildStack(
  path: string,
  secrets: SecretStore,
  requests: CapturedRequest[],
  options: { encoder?: SemanticEncoder; conversationId?: string } = {}
): Stack {
  const database = SqliteDatabase.open(path)
  databases.push(database)
  const events = new EventLogService(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database), undefined, undefined, events)
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const fetcher = async (_url: string, init?: { body?: unknown }): Promise<Response> => {
    const payload = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
    requests.push({
      system: payload.messages.find((message) => message.role === 'system')?.content ?? '',
      user: payload.messages.find((message) => message.role === 'user')?.content ?? ''
    })
    return sseResponse([
      `data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      'data: [DONE]\n\n'
    ])
  }
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: async (preview) => approve(preview),
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, fetcher),
    ...(options.encoder ? { semanticEncoder: options.encoder } : {})
  })
  const conversationId = options.conversationId ?? companion.createConversation().id
  return {
    database,
    memories,
    companion,
    conversationId,
    requests,
    close: () => {
      companion.shutdown()
      database.close()
      const index = databases.indexOf(database)
      if (index >= 0) databases.splice(index, 1)
    }
  }
}

async function ask(stack: Stack, content: string): Promise<CapturedRequest> {
  await stack.companion.sendChat({
    conversationId: stack.conversationId,
    requestId: randomUUID(),
    content,
    includeSensitive: false
  }, () => undefined)
  const request = stack.requests[stack.requests.length - 1]
  if (!request) throw new Error('No provider request was dispatched.')
  return request
}

/**
 * Hand-built encoder: only used to prove the wiring, not the semantics.
 * It scores a fixed set of (text, topic) pairs so that "eat" and "meals" share a
 * topic while unrelated memories do not.
 */
function createStubEncoder(): SemanticEncoder {
  const topics: Array<[RegExp, number[]]> = [
    [/eat|meal|food|dinner|lunch|vegetarian/iu, [1, 0, 0]],
    [/tea|coffee|drink/iu, [0, 1, 0]],
    [/work|job|analyst/iu, [0, 0, 1]]
  ]
  return {
    modelId: 'stub-topic-encoder',
    async embed(texts: readonly string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vector = new Float32Array([0.05, 0.05, 0.05])
        for (const [pattern, axis] of topics) {
          if (!pattern.test(text)) continue
          for (let index = 0; index < 3; index += 1) vector[index]! += axis[index]!
        }
        const norm = Math.hypot(vector[0]!, vector[1]!, vector[2]!)
        return vector.map((value) => value / norm) as Float32Array
      })
    }
  }
}

let directory: string
let databasePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'morrow-semantic-loop-'))
  directories.push(directory)
  databasePath = join(directory, 'morrow.sqlite3')
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
    const target = directories.pop()
    if (target) rmSync(target, { recursive: true, force: true })
  }
})

describe('semantic signals reach the dispatched request', () => {
  it('recalls a paraphrase-only match that lexical retrieval cannot see', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder: createStubEncoder() })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I prefer vegetarian meals.', 'personal')
      stack.memories.create('I drink black coffee every morning.', 'personal')

      const request = await ask(stack, 'What should I eat for dinner?')

      expect(request.system).toContain('vegetarian meals')
      expect(request.system).not.toContain('black coffee')
    } finally {
      stack.close()
    }
  })

  it('falls back to lexical retrieval when the encoder fails, without breaking the turn', async () => {
    const requests: CapturedRequest[] = []
    const brokenEncoder: SemanticEncoder = {
      modelId: 'broken',
      async embed(): Promise<Float32Array[]> {
        throw new Error('model exploded')
      }
    }
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder: brokenEncoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I prefer green tea in the afternoon.', 'personal')

      const request = await ask(stack, 'Which tea do I prefer?')

      expect(request.system).toContain('green tea in the afternoon')
      const decision = stack.database.connection
        .prepare("SELECT payload_json FROM event_journal WHERE event_type = 'retrieval.decision' ORDER BY rowid DESC LIMIT 1")
        .get() as { payload_json: string }
      expect(JSON.parse(decision.payload_json).semantic).toEqual({ modelId: null, applied: false })
    } finally {
      stack.close()
    }
  })

  it('keeps retrieval working with no encoder at all', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests)
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I prefer green tea in the afternoon.', 'personal')

      const request = await ask(stack, 'Which tea do I prefer?')
      expect(request.system).toContain('green tea in the afternoon')
    } finally {
      stack.close()
    }
  })
})

describe.skipIf(!hasRealModel)('real embedding model, end to end', () => {
  let encoder: SemanticEncoder

  beforeEach(async () => {
    encoder = await createOnnxSemanticEncoder({ modelId: MODEL_ID, cacheDirectory: MODEL_DIRECTORY })
  })

  it('surfaces a standing preference for a differently worded question', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I prefer vegetarian meals.', 'personal')
      stack.memories.create('I visited Osaka last spring.', 'personal')

      const request = await ask(stack, 'What should I eat for dinner?')

      expect(request.system).toContain('vegetarian meals')
      expect(request.system).not.toContain('Osaka')
      const decision = stack.database.connection
        .prepare("SELECT payload_json FROM event_journal WHERE event_type = 'retrieval.decision' ORDER BY rowid DESC LIMIT 1")
        .get() as { payload_json: string }
      const payload = JSON.parse(decision.payload_json) as { algorithm: string; semantic: { applied: boolean; modelId: string } }
      expect(payload.algorithm).toBe('memory-retrieval-v3-hybrid')
      expect(payload.semantic.applied).toBe(true)
      expect(payload.semantic.modelId).toBe(MODEL_ID)
    } finally {
      stack.close()
    }
  })

  it('does not revive a corrected statement even though it is semantically identical', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const original = stack.memories.create('I love crowded parties.', 'personal')
      stack.memories.correct(original.id, 'I avoid crowded parties now.')
      stack.memories.create('I love crowded parties.', 'personal')

      const request = await ask(stack, 'How do I feel about parties?')

      expect(request.system).toContain('avoid crowded parties')
      expect(request.system).not.toContain('love crowded parties')
    } finally {
      stack.close()
    }
  })

  it('does not let the semantic index resurface a deleted memory', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const allergy = stack.memories.create('I am allergic to shellfish.', 'personal')
      stack.memories.delete(allergy.id)

      const request = await ask(stack, 'What should I avoid eating?')
      expect(request.system).not.toContain('shellfish')
    } finally {
      stack.close()
    }
  })

  it('keeps the same answer after a restart', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const first = buildStack(databasePath, secrets, requests, { encoder })
    let conversationId: string
    try {
      first.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      first.memories.create('I prefer vegetarian meals.', 'personal')
      conversationId = first.conversationId
    } finally {
      first.close()
    }

    const second = buildStack(databasePath, secrets, requests, { encoder, conversationId })
    try {
      const request = await ask(second, 'What should I eat for dinner?')
      expect(request.system).toContain('vegetarian meals')
    } finally {
      second.close()
    }
  })

  it('still respects the context budget with many memories', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      for (let index = 0; index < 30; index += 1) {
        stack.memories.create(`Synthetic meal note ${index}: I usually eat a light dinner.`, 'personal')
      }

      await ask(stack, 'What should I eat for dinner?')
      // The budget applies to the encoded memory JSON, which is what the
      // decision records; the surrounding system prompt is not part of it.
      const decision = stack.database.connection
        .prepare("SELECT payload_json FROM event_journal WHERE event_type = 'retrieval.decision' ORDER BY rowid DESC LIMIT 1")
        .get() as { payload_json: string }
      const payload = JSON.parse(decision.payload_json) as { characterCount: number; contextBudget: number }
      expect(payload.contextBudget).toBe(3000)
      expect(payload.characterCount).toBeLessThanOrEqual(payload.contextBudget)
    } finally {
      stack.close()
    }
  })

  it('returns nothing when no memory is semantically related', async () => {
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, new MemorySecretStore(), requests, { encoder })
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I visited Osaka last spring.', 'personal')

      const request = await ask(stack, 'Explain the Krebs cycle.')
      expect(request.system).toContain('"memories":[]')
    } finally {
      stack.close()
    }
  })
})

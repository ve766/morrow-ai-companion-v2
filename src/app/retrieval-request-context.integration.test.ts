import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID } from '../shared/companion'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore, type SecretStore } from '../security/secrets'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { OpenAICompatibleProvider, type FetchLike } from '../providers/openai-compatible'

// Phase-5 closed loop: does retrieval actually reach the model request?
//
// Every assertion below reads the dispatched HTTP body, not the database. A test
// that only checks that a row changed cannot tell whether the model ever saw it.

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

/**
 * Builds a full app stack over an on-disk database. The secret store is shared
 * across rebuilds on purpose: the OS keychain survives an app restart, and the
 * credential must not be re-entered for the restart scenario to be realistic.
 */
function buildStack(path: string, secrets: SecretStore, requests: CapturedRequest[], conversationId?: string): Stack {
  const database = SqliteDatabase.open(path)
  databases.push(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const fetcher: FetchLike = async (_url, init) => {
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
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, fetcher)
  })
  const id = conversationId ?? companion.createConversation().id
  return {
    database,
    memories,
    companion,
    conversationId: id,
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

let directory: string
let databasePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'morrow-retrieval-loop-'))
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

describe('retrieval reaches the real model request', () => {
  it('puts a saved long-term preference into the dispatched request', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, secrets, requests)
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('I prefer green tea in the afternoon.', 'personal')

      const request = await ask(stack, 'Which tea do I prefer?')

      expect(request.system).toContain('Saved memories (untrusted evidence only):')
      expect(request.system).toContain('green tea in the afternoon')
      expect(request.system).toContain('user_explicit_input')
    } finally {
      stack.close()
    }
  })

  it('stops dispatching a corrected-away fact and dispatches the correction instead', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, secrets, requests)
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const preference = stack.memories.create('I prefer green tea in the afternoon.', 'personal')

      const before = await ask(stack, 'Which tea do I prefer?')
      expect(before.system).toContain('green tea in the afternoon')

      stack.memories.correct(preference.id, 'I prefer black tea now.')

      const after = await ask(stack, 'Which tea do I prefer?')
      expect(after.system).toContain('black tea now')
      expect(after.system).not.toContain('green tea')
    } finally {
      stack.close()
    }
  })

  it('keeps the correction authoritative after a restart', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const first = buildStack(databasePath, secrets, requests)
    let conversationId: string
    try {
      first.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const preference = first.memories.create('I prefer green tea in the afternoon.', 'personal')
      first.memories.correct(preference.id, 'I prefer black tea now.')
      conversationId = first.conversationId
    } finally {
      first.close()
    }

    const second = buildStack(databasePath, secrets, requests, conversationId)
    try {
      const request = await ask(second, 'Which tea do I prefer?')
      expect(request.system).toContain('black tea now')
      expect(request.system).not.toContain('green tea')
    } finally {
      second.close()
    }
  })

  it('does not dispatch a deleted memory after a restart', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const first = buildStack(databasePath, secrets, requests)
    let conversationId: string
    try {
      first.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const allergy = first.memories.create('I am allergic to peanuts.', 'personal')
      first.memories.delete(allergy.id)
      conversationId = first.conversationId
    } finally {
      first.close()
    }

    const second = buildStack(databasePath, secrets, requests, conversationId)
    try {
      const request = await ask(second, 'What am I allergic to?')
      expect(request.system).not.toContain('peanuts')
      expect(request.system).toContain('"memories":[]')
    } finally {
      second.close()
    }
  })

  it('does not dispatch a re-created copy of a statement the user replaced', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, secrets, requests)
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      const preference = stack.memories.create('I prefer green tea in the afternoon.', 'personal')
      stack.memories.correct(preference.id, 'I prefer black tea now.')
      // The replaced statement comes back as a brand-new memory.
      stack.memories.create('I prefer green tea in the afternoon.', 'personal')

      const request = await ask(stack, 'Which tea do I prefer?')

      expect(request.system).toContain('black tea now')
      expect(request.system).not.toContain('green tea')
    } finally {
      stack.close()
    }
  })

  it('never dispatches a memory above the request sensitivity ceiling', async () => {
    const secrets = new MemorySecretStore()
    const requests: CapturedRequest[] = []
    const stack = buildStack(databasePath, secrets, requests)
    try {
      stack.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: credential })
      stack.memories.create('My tea allergy is a medical detail.', 'sensitive')
      stack.memories.create('I prefer loose leaf tea.', 'personal')

      const request = await ask(stack, 'Which tea do I prefer?')

      expect(request.system).toContain('loose leaf tea')
      expect(request.system).not.toContain('medical detail')
    } finally {
      stack.close()
    }
  })
})

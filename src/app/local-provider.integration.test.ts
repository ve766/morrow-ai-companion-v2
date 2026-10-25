import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore, type SecretStore } from '../security/secrets'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const servers: Server[] = []

interface CapturedRequest {
  url: string
  authorization: string | null
  body: {
    model: string
    stream: boolean
    thinking?: unknown
    messages: Array<{ role: string; content: string }>
  }
}

function startLocalModelServer(options: { expectBearer?: string } = {}): { raw: Server; requests: CapturedRequest[]; close: () => Promise<void> } {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    request.on('end', () => {
      const authorization = request.headers.authorization ?? null
      requests.push({
        url: request.url ?? '',
        authorization,
        body: JSON.parse(raw) as CapturedRequest['body']
      })
      if (options.expectBearer !== undefined && authorization !== `Bearer ${options.expectBearer}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'bad credentials' }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ model: 'test-local-model-returned', choices: [{ delta: { content: 'Local model reply.' } }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  return {
    raw: server,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
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

function setup(secrets: SecretStore = new MemorySecretStore()) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-local-provider-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  // The real OpenAICompatibleProvider with the real global fetch is used on
  // purpose: this test exercises the actual HTTP path against a loopback
  // server, not an injected adapter.
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: async (preview) => approve(preview)
  })
  return { database, memories, conversations, secrets, companion, conversation: companion.createConversation() }
}

beforeEach(() => {
  vi.stubGlobal('fetch', globalThis.fetch)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const database of databases.splice(0)) {
    try {
      database.close()
    } catch {
      continue
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local loopback provider (real HTTP over 127.0.0.1)', () => {
  it('rejects a non-loopback endpoint before anything is stored', () => {
    const context = setup()
    expect(() => context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'http://10.1.2.3:1234', model: 'test-local-model', enabled: false }))
      .toThrowError(new ApplicationError('INVALID_INPUT'))
    expect(() => context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'http://user:pass@127.0.0.1:1234', model: 'test-local-model', enabled: false }))
      .toThrowError(new ApplicationError('INVALID_INPUT'))
    expect(() => context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: 'https://api.example.com', model: 'test-local-model', enabled: false }))
      .toThrowError(new ApplicationError('INVALID_INPUT'))
  })

  it('completes a real multi-turn chat against a loopback OpenAI-compatible server without any credential', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const context = setup()
    try {
      const configured = context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'test-local-model', enabled: true })
      expect(configured).toMatchObject({ id: 'local-openai', providerClass: 'local', enabled: true, apiKeyConfigured: false })

      const connection = await context.companion.testProviderConnection({ providerId: LOCAL_PROVIDER_ID })
      expect(connection).toMatchObject({ providerId: LOCAL_PROVIDER_ID, connected: true })

      const first = await context.companion.sendChat({ conversationId: context.conversation.id, requestId: randomUUID(), content: '你好，简单介绍一下你自己。', includeSensitive: false }, () => {})
      expect(first.assistantMessage.body).toBe('Local model reply.')
      const second = await context.companion.sendChat({ conversationId: context.conversation.id, requestId: randomUUID(), content: '接着刚才的话题继续。', includeSensitive: false }, () => {})
      expect(second.assistantMessage.body).toBe('Local model reply.')

      const chatRequests = server.requests.filter((request) => request.url.endsWith('/chat/completions'))
      expect(chatRequests.length).toBeGreaterThanOrEqual(3)
      expect(chatRequests[0]?.authorization).toBeNull()
      expect(chatRequests[0]?.body.model).toBe('test-local-model')
      expect(chatRequests[0]?.body.stream).toBe(true)
      expect(chatRequests[0]?.body.thinking).toBeUndefined()
      const lastRequest = chatRequests.at(-1)
      const lastUser = lastRequest?.body.messages.filter((message) => message.role === 'user').at(-1)
      expect(lastUser?.content).toContain('接着刚才的话题继续。')
      expect(JSON.stringify(lastRequest?.body.messages)).toContain('你好，简单介绍一下你自己。')
    } finally {
      await server.close()
    }
  })

  it('sends the stored credential as a bearer header when one is configured', async () => {
    const credential = 'local-server-token'
    const server = startLocalModelServer({ expectBearer: credential })
    const url = await listen(server.raw)
    const context = setup()
    try {
      context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'test-local-model', enabled: true, apiKey: credential })
      const result = await context.companion.sendChat({ conversationId: context.conversation.id, requestId: randomUUID(), content: 'hi', includeSensitive: false }, () => {})
      expect(result.assistantMessage.body).toBe('Local model reply.')
      expect(context.companion.getProvider({ providerId: LOCAL_PROVIDER_ID })?.apiKeyConfigured).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('prefers the enabled local provider for chat while a configured DeepSeek stays secondary', async () => {
    const server = startLocalModelServer()
    const url = await listen(server.raw)
    const context = setup()
    try {
      context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'test-only-deepseek-key' })
      context.companion.saveProvider({ providerId: LOCAL_PROVIDER_ID, endpoint: url, model: 'test-local-model', enabled: true })

      await context.companion.sendChat({ conversationId: context.conversation.id, requestId: randomUUID(), content: 'who is active?', includeSensitive: false }, () => {})
      const chatRequests = server.requests.filter((request) => request.url.endsWith('/chat/completions'))
      expect(chatRequests).toHaveLength(1)
      expect(context.companion.getProvider()?.id).toBe(LOCAL_PROVIDER_ID)
      expect(context.companion.getProvider({ providerId: DEEPSEEK_PROVIDER_ID })?.enabled).toBe(true)
    } finally {
      await server.close()
    }
  })
})

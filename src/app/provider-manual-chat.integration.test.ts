import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, LOCAL_PROVIDER_ID } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { CompanionService } from './companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteDatabase } from '../persistence/database'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore, type SecretStore } from '../security/secrets'
import { SecretStoreError } from '../security/secret-store-error'
import type { ProviderConsent, ProviderConsentPreview } from '../providers/provider-policy'
import { OpenAICompatibleProvider, type FetchLike } from '../providers/openai-compatible'

const directories: string[] = []
const databases: SqliteDatabase[] = []
const testCredential = 'offline-only-invalid-provider-key'
const blockedFetch: FetchLike = async () => {
  throw new Error('Live network access is forbidden in this test.')
}

function responseWithChunks(chunks: string[]): Response {
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

function setup(options: {
  secrets?: SecretStore
  authorize?: (preview: ProviderConsentPreview) => Promise<ProviderConsent | undefined>
  fetcher?: FetchLike
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'morrow-provider-manual-'))
  directories.push(directory)
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  databases.push(database)
  const memories = new MemoryService(new SqliteMemoryRepository(database))
  const conversations = new ConversationService(new SqliteConversationRepository(database))
  const secrets = options.secrets ?? new MemorySecretStore()
  const companion = new CompanionService({
    database,
    memories,
    conversations,
    secrets,
    authorize: options.authorize ?? (async (preview) => approve(preview)),
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, options.fetcher ?? blockedFetch)
  })
  return { database, memories, conversations, secrets, companion, conversation: companion.createConversation() }
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('The global network path is forbidden in provider integration tests.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const database of databases.splice(0)) {
    try {
      database.close()
    } catch {
      continue
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('offline manual Provider configuration and chat path', () => {
  it('stores only the credential-presence flag in SQLite and completes a user-approved chat through a mocked OpenAI-compatible stream', async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error('The global network path must never be used by this test.')
    })
    vi.stubGlobal('fetch', globalFetch)
    const authorize = vi.fn(async (preview: ProviderConsentPreview) => approve(preview))
    const fetcher = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe(`${DEEPSEEK_API_BASE_URL}/chat/completions`)
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${testCredential}`)
      expect(headers.get('content-type')).toBe('application/json')
      const bodyText = String(init?.body)
      expect(bodyText).not.toContain(testCredential)
      const body = JSON.parse(bodyText) as {
        model: string
        stream: boolean
        messages: Array<{ role: string; content: string }>
      }
      expect(body.model).toBe(DEEPSEEK_MODEL)
      expect(body.stream).toBe(true)
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Which tea do I prefer?' })
      expect(JSON.stringify(body.messages)).toContain('jasmine tea')
      expect(JSON.stringify(body.messages)).not.toContain('private allergy')
      return responseWithChunks([
        `data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: 'You prefer jasmine tea.' } }] })}\n\n`,
        'data: [DONE]\n\n'
      ])
    })
    const context = setup({ authorize, fetcher })
    const userText = 'Which tea do I prefer?'
    try {
      expect(context.companion.getProvider()).toBeNull()
      const configured = context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
      expect(configured).toMatchObject({ id: 'deepseek', enabled: true, apiKeyConfigured: true })
      expect(configured).not.toHaveProperty('apiKey')
      expect(JSON.stringify(context.database.connection.prepare('SELECT * FROM provider_profiles').all())).not.toContain(testCredential)
      expect(context.secrets.get('deepseek')).toBe(testCredential)
      context.memories.create('I prefer jasmine tea in the evening.', 'personal')
      context.memories.create('Private allergy information that must stay local.', 'sensitive')

      const deltas: string[] = []
      const result = await context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: userText,
        includeSensitive: false
      }, (delta) => deltas.push(delta))

      expect(authorize).toHaveBeenCalledTimes(1)
      expect(authorize.mock.calls[0]?.[0]).toMatchObject({
        action: 'chat',
        providerId: 'deepseek',
        endpoint: `${DEEPSEEK_API_BASE_URL}/chat/completions`,
        model: DEEPSEEK_MODEL,
        maximumSensitivity: 'personal'
      })
      const preview = authorize.mock.calls[0]?.[0]
      expect(preview?.exactPayload).not.toContain(testCredential)
      expect(preview?.exactPayload).not.toContain('private allergy')
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(globalFetch).not.toHaveBeenCalled()
      expect(deltas).toEqual(['You prefer jasmine tea.'])
      expect(result.assistantMessage.body).toBe('You prefer jasmine tea.')
      expect(result.includedMemoryCount).toBe(1)
      expect(context.conversations.read(context.conversation.id).messages.map((message) => [message.role, message.body]))
        .toEqual([['user', userText], ['assistant', 'You prefer jasmine tea.']])
      expect(JSON.stringify(context.companion.getProvider())).not.toContain(testCredential)
    } finally {
      context.companion.shutdown()
    }
  })

  it('does not dispatch a chat when the native approval boundary denies the exact payload', async () => {
    const fetcher = vi.fn<FetchLike>(blockedFetch)
    const context = setup({ authorize: async () => undefined, fetcher })
    try {
      context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
      await expect(context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'Do not send this without approval.',
        includeSensitive: false
      }, () => undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(fetcher).not.toHaveBeenCalled()
      expect(context.conversations.read(context.conversation.id).messages).toEqual([])
    } finally {
      context.companion.shutdown()
    }
  })

  it('keeps the connection test separate from chat and sends only its fixed prompt through a mock', async () => {
    const previews: ProviderConsentPreview[] = []
    const authorize = vi.fn(async (preview: ProviderConsentPreview) => {
      previews.push(preview)
      return approve(preview)
    })
    const fetcher = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe(`${DEEPSEEK_API_BASE_URL}/chat/completions`)
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      expect(body.messages).toHaveLength(1)
      expect((JSON.parse(String(init?.body)) as { stream: boolean }).stream).toBe(true)
      expect(body.messages).toEqual([{ role: 'user', content: 'Reply with exactly OK to confirm the API connection.' }])
      expect(JSON.stringify(body)).not.toContain(testCredential)
      return responseWithChunks([
        `data: ${JSON.stringify({ model: DEEPSEEK_MODEL, choices: [{ delta: { content: 'OK' } }] })}\n\n`,
        'data: [DONE]\n\n'
      ])
    })
    const context = setup({ authorize, fetcher })
    try {
      context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
      await expect(context.companion.testProviderConnection({ providerId: 'deepseek' })).resolves.toEqual({
        providerId: 'deepseek',
        model: DEEPSEEK_MODEL,
        connected: true
      })
      expect(previews).toHaveLength(1)
      expect(previews[0]?.action).toBe('connection-test')
      expect(previews[0]?.exactPayload).not.toContain(testCredential)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(context.conversations.read(context.conversation.id).messages).toEqual([])
    } finally {
      context.companion.shutdown()
    }
  })

  it('fails closed when enabled without a key or when key storage fails, leaving no enabled SQLite profile', () => {
    const context = setup()
    try {
      expect(() => context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true }))
        .toThrowError(new ApplicationError('PROVIDER_UNCONFIGURED'))
      expect(() => context.database.connection.prepare('SELECT * FROM provider_profiles').all()).not.toThrow()
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get()).toEqual({ count: 0 })

      const failingSecrets: SecretStore = {
        isAvailable: () => true,
        get: () => undefined,
        set: () => { throw new Error('synthetic secure-storage failure') },
        delete: () => undefined
      }
      const failing = setup({ secrets: failingSecrets })
      expect(() => failing.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential }))
        .toThrowError(new ApplicationError('PROVIDER_STORAGE_UNAVAILABLE'))
      expect(failing.database.connection.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get()).toEqual({ count: 0 })
    } finally {
      context.companion.shutdown()
    }
  })

  it('rolls back provider settings if a newly written credential cannot be read back', () => {
    const set = vi.fn()
    const remove = vi.fn()
    const secrets: SecretStore = {
      isAvailable: () => true,
      get: () => undefined,
      set,
      delete: remove
    }
    const context = setup({ secrets })
    try {
      expect(() => context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential }))
        .toThrowError(new ApplicationError('PROVIDER_STORAGE_UNAVAILABLE'))
      expect(set).toHaveBeenCalledWith('deepseek', testCredential)
      expect(remove).toHaveBeenCalledWith('deepseek')
      expect(context.database.connection.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get()).toEqual({ count: 0 })
    } finally {
      context.companion.shutdown()
    }
  })

  it('does not report successful credential deletion when secure storage deletion fails', () => {
    const secrets = new MemorySecretStore()
    const context = setup({ secrets })
    context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
    const failingDelete: SecretStore = {
      isAvailable: () => true,
      get: (id) => secrets.get(id),
      set: (id, value) => secrets.set(id, value),
      delete: () => { throw new Error('synthetic secure-storage delete failure') }
    }
    const failing = setup({ secrets: failingDelete })
    try {
      expect(() => failing.companion.clearProviderCredential())
        .toThrowError(new ApplicationError('PROVIDER_STORAGE_UNAVAILABLE'))
      expect(secrets.get('deepseek')).toBe(testCredential)
    } finally {
      context.companion.shutdown()
      failing.companion.shutdown()
    }
  })

  it('keeps corrupt credentials distinct from missing, refuses replacement, and blocks chat before egress', async () => {
    const backing = new MemorySecretStore()
    let corrupt = false
    const set = vi.fn((id: string, value: string) => backing.set(id, value))
    const remove = vi.fn((id: string) => backing.delete(id))
    const secrets: SecretStore = {
      isAvailable: () => true,
      get: (id) => {
        if (corrupt) throw new SecretStoreError('decrypt_failed')
        return backing.get(id)
      },
      set,
      delete: remove
    }
    const authorize = vi.fn(async (preview: ProviderConsentPreview) => approve(preview))
    const fetcher = vi.fn<FetchLike>(blockedFetch)
    const context = setup({ secrets, authorize, fetcher })
    try {
      context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
      corrupt = true

      expect(() => context.companion.getProvider())
        .toThrowError(new ApplicationError('PROVIDER_CREDENTIAL_STORE_ERROR'))
      expect(() => context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: 'replacement-synthetic-key' }))
        .toThrowError(new ApplicationError('PROVIDER_CREDENTIAL_STORE_ERROR'))
      await expect(context.companion.sendChat({
        conversationId: context.conversation.id,
        requestId: randomUUID(),
        content: 'This must not leave the device.',
        includeSensitive: false
      }, () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_STORE_ERROR' })

      expect(set).toHaveBeenCalledTimes(1)
      expect(remove).not.toHaveBeenCalled()
      expect(backing.get('deepseek')).toBe(testCredential)
      expect(authorize).not.toHaveBeenCalled()
      expect(fetcher).not.toHaveBeenCalled()
      expect(context.conversations.read(context.conversation.id).messages).toEqual([])
    } finally {
      context.companion.shutdown()
    }
  })

  it('rechecks credentials after user consent and blocks egress if ciphertext becomes unreadable', async () => {
    const backing = new MemorySecretStore()
    let corrupt = false
    const secrets: SecretStore = {
      isAvailable: () => true,
      get: (id) => {
        if (corrupt) throw new SecretStoreError('decrypt_failed')
        return backing.get(id)
      },
      set: (id, value) => backing.set(id, value),
      delete: (id) => backing.delete(id)
    }
    const fetcher = vi.fn<FetchLike>(blockedFetch)
    const authorize = vi.fn(async (preview: ProviderConsentPreview) => {
      const consent = approve(preview)
      corrupt = true
      return consent
    })
    const context = setup({ secrets, authorize, fetcher })
    try {
      context.companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODEL, enabled: true, apiKey: testCredential })
      await expect(context.companion.testProviderConnection({ providerId: 'deepseek' }))
        .rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_STORE_ERROR' })
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(fetcher).not.toHaveBeenCalled()
      expect(backing.get('deepseek')).toBe(testCredential)
    } finally {
      context.companion.shutdown()
    }
  })
})

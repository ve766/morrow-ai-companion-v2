import { describe, expect, it } from 'vitest'
import { CompanionService } from '../app/companion-service'
import { ConversationService } from '../conversation/conversation-service'
import { MemoryService } from '../memory/memory-service'
import { SqliteConversationRepository } from '../persistence/conversation-repository'
import { SqliteDatabase } from '../persistence/database'
import { SqliteMemoryRepository } from '../persistence/memory-repository'
import { MemorySecretStore } from '../security/secrets'
import { THIRD_PARTY_PROVIDER_ID, DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL, type ProviderConfigRecord } from '../shared/companion'
import { OpenAICompatibleProvider, type FetchLike } from './openai-compatible'

/**
 * The third-party gateway is a new provider id, not a loosened DeepSeek one.
 * These tests pin the parts that would be dangerous to get wrong: what a saved
 * configuration may contain, where the request actually goes, and that the key
 * never appears in anything a report or an error message could carry.
 */

const clock = (): string => '2026-10-27T12:00:00.000Z'

function harness(fetcher?: FetchLike) {
  const database = SqliteDatabase.open(':memory:')
  const secrets = new MemorySecretStore()
  const companion = new CompanionService({
    database,
    memories: new MemoryService(new SqliteMemoryRepository(database), clock),
    conversations: new ConversationService(new SqliteConversationRepository(database), clock),
    secrets,
    authorize: async () => undefined,
    clock,
    providerFactory: (config) => new OpenAICompatibleProvider(config, secrets, fetcher, 5_000)
  })
  return { database, secrets, companion }
}

function config(overrides: Partial<ProviderConfigRecord> = {}): ProviderConfigRecord {
  return {
    id: THIRD_PARTY_PROVIDER_ID,
    providerClass: 'remote',
    endpoint: 'https://gateway.example.com/v1',
    model: 'some-model',
    enabled: true,
    apiKeyConfigured: true,
    updatedAt: clock(),
    timeoutMs: 30_000,
    catalogVerified: false,
    ...overrides
  }
}

describe('a third-party gateway must be configured deliberately', () => {
  it('refuses plain http, embedded credentials and a missing acknowledgement', () => {
    const { companion } = harness()
    const base = { providerId: THIRD_PARTY_PROVIDER_ID, model: 'm', enabled: true, apiKey: 'k', acknowledgeThirdParty: true } as const
    expect(() => companion.saveProvider({ ...base, endpoint: 'http://gateway.example.com/v1' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(() => companion.saveProvider({ ...base, endpoint: 'https://user:pass@gateway.example.com/v1' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(() => companion.saveProvider({ ...base, endpoint: 'https://gateway.example.com/v1?key=1' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(() => companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1',
      model: 'm',
      enabled: true,
      apiKey: 'k'
    } as unknown as Parameters<typeof companion.saveProvider>[0]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(companion.getProvider({ providerId: THIRD_PARTY_PROVIDER_ID })).toBeNull()
  })

  it('refuses to enable without a stored key', () => {
    const { companion } = harness()
    expect(() => companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1',
      model: 'm',
      enabled: true,
      acknowledgeThirdParty: true
    })).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNCONFIGURED' }))
  })

  it('normalises the base URL instead of letting the caller paste a chat URL', () => {
    const { companion } = harness()
    const saved = companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1/chat/completions',
      model: 'm',
      enabled: true,
      apiKey: 'k',
      acknowledgeThirdParty: true
    })
    expect(saved.endpoint).toBe('https://gateway.example.com/v1')
    const trailing = companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1///',
      model: 'm',
      enabled: true,
      acknowledgeThirdParty: true
    })
    expect(trailing.endpoint).toBe('https://gateway.example.com/v1')
  })

  it('never returns the key in the configuration record', () => {
    const { companion } = harness()
    const saved = companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1',
      model: 'm',
      enabled: true,
      apiKey: 'sk-secret-value',
      acknowledgeThirdParty: true
    })
    expect(JSON.stringify(saved)).not.toContain('sk-secret-value')
    expect(saved.apiKeyConfigured).toBe(true)
    expect(saved.catalogVerified).toBe(false)
  })

  it('keeps the DeepSeek default pinned', () => {
    const { companion } = harness()
    expect(() => companion.saveProvider({ providerId: DEEPSEEK_PROVIDER_ID, model: 'other-model', enabled: true } as never))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })
})

describe('the provider sends the request where the configuration says', () => {
  it('posts to {base}/chat/completions exactly once, with the key in a header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetcher: FetchLike = async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response(JSON.stringify({ model: 'some-model', choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }
    const provider = new OpenAICompatibleProvider(config(), {
      isAvailable: () => true,
      set: () => undefined,
      get: () => 'sk-secret-value',
      delete: () => undefined
    }, fetcher)
    const output = await provider.generate({
      prompt: 'x',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'https://gateway.example.com/v1/chat/completions',
      maximumSensitivity: 'normal',
      requestPayload: { model: 'some-model', messages: [{ role: 'user', content: 'x' }] }
    })
    expect(output.text).toBe('ok')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://gateway.example.com/v1/chat/completions')
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-secret-value')
  })

  it('rejects a chat URL that does not match the configured base', async () => {
    const provider = new OpenAICompatibleProvider(config(), {
      isAvailable: () => true,
      set: () => undefined,
      get: () => 'k',
      delete: () => undefined
    }, async () => new Response('{}', { status: 200 }))
    await expect(provider.generate({
      prompt: 'x',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'https://elsewhere.example.com/v1/chat/completions',
      maximumSensitivity: 'normal',
      requestPayload: { model: 'some-model', messages: [{ role: 'user', content: 'x' }] }
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('is not usable without a key', async () => {
    const provider = new OpenAICompatibleProvider(config({ apiKeyConfigured: false }), {
      isAvailable: () => true,
      set: () => undefined,
      get: () => undefined,
      delete: () => undefined
    }, async () => new Response('{}', { status: 200 }))
    expect(provider.profile.configured).toBe(false)
    await expect(provider.generate({
      prompt: 'x',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'https://gateway.example.com/v1/chat/completions',
      maximumSensitivity: 'normal',
      requestPayload: { model: 'some-model', messages: [{ role: 'user', content: 'x' }] }
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('the model catalogue probe reports facts, not optimism', () => {
  const secrets = {
    isAvailable: () => true,
    set: () => undefined,
    get: () => 'k',
    delete: () => undefined
  }

  it('returns the ids the service lists', async () => {
    const provider = new OpenAICompatibleProvider(config(), secrets, async () =>
      new Response(JSON.stringify({ data: [{ id: 'a' }, { id: '入梦 Flash' }] }), { status: 200 }))
    await expect(provider.listModels()).resolves.toEqual({ ids: ['a', '入梦 Flash'] })
  })

  it('maps 401 to PROVIDER_AUTH and invalid JSON to PROVIDER_RESPONSE', async () => {
    const unauthorized = new OpenAICompatibleProvider(config(), secrets, async () => new Response(null, { status: 401 }))
    await expect(unauthorized.listModels()).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })
    const malformed = new OpenAICompatibleProvider(config(), secrets, async () => new Response('<html>', { status: 200 }))
    await expect(malformed.listModels()).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
    const missing = new OpenAICompatibleProvider(config(), secrets, async () => new Response('{"nope":1}', { status: 200 }))
    await expect(missing.listModels()).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
  })

  it('marks a model as catalogue-verified only when asked, and resets it when the model changes', () => {
    const { companion } = harness()
    companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1',
      model: 'a',
      enabled: true,
      apiKey: 'k',
      acknowledgeThirdParty: true
    })
    expect(companion.getProvider({ providerId: THIRD_PARTY_PROVIDER_ID })?.catalogVerified).toBe(false)
    companion.providers.markCatalogVerified(THIRD_PARTY_PROVIDER_ID, true)
    expect(companion.getProvider({ providerId: THIRD_PARTY_PROVIDER_ID })?.catalogVerified).toBe(true)
    // A different model id is a different claim.
    companion.saveProvider({
      providerId: THIRD_PARTY_PROVIDER_ID,
      endpoint: 'https://gateway.example.com/v1',
      model: 'b',
      enabled: true,
      acknowledgeThirdParty: true
    })
    expect(companion.getProvider({ providerId: THIRD_PARTY_PROVIDER_ID })?.catalogVerified).toBe(false)
  })
})

/**
 * Multi-source provider foundation: migration compatibility, two isolated
 * custom profiles, endpoint validation, connection test, discovery, consent
 * invalidation and the real adapter path (mock HTTP).
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMigrations } from '../persistence/migrations'
import { SqliteDatabase } from '../persistence/database'
import { MemorySecretStore, type SecretStore } from '../security/secrets'
import { SecretStoreError } from '../security/secret-store-error'
import { ProviderConfigService } from './companion-service'
import { OpenAICompatibleProvider } from '../providers/openai-compatible'
import { createEndpointPolicy } from '../providers/endpoint-security'
import { assessProviderRequest, consentPreview, type ProviderConsentPreview } from '../providers/provider-policy'
import type { ProviderConfigRecord } from '../shared/companion'

let directory = ''
afterEach(() => {
  if (directory) {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
    directory = ''
  }
})

function approve(preview: ProviderConsentPreview) {
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    includeSensitive: preview.maximumSensitivity === 'sensitive'
  }
}

function openService(secretStore: SecretStore = new MemorySecretStore()): {
  database: SqliteDatabase
  service: ProviderConfigService
  secrets: SecretStore
  previews: ProviderConsentPreview[]
  fetcher: ReturnType<typeof vi.fn>
} {
  directory = mkdtempSync(join(tmpdir(), 'morrow-multi-provider-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const secrets = secretStore
  const previews: ProviderConsentPreview[] = []
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean }
    if (body.stream) {
      return new Response(`data: ${JSON.stringify({ model: 'gemini-3-flash', choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    return new Response(JSON.stringify({ model: 'gemini-3-flash', choices: [{ message: { content: 'OK' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  const policy = createEndpointPolicy(async () => [{ address: '8.8.8.8' }])
  const service = new ProviderConfigService(
    database,
    secrets,
    async (preview) => { previews.push(preview); return approve(preview) },
    () => '2026-11-04T00:00:00.000Z',
    (config) => new OpenAICompatibleProvider(config, secrets, fetcher as never, 5_000, { maxAttempts: 1 }, policy),
    fetcher as never,
    policy
  )
  return { database, service, secrets, previews, fetcher }
}

const profileA = {
  displayName: 'Relay A',
  sourceKind: 'custom-proxy' as const,
  protocolId: 'openai-chat-completions' as const,
  endpoint: 'https://relay-a.example.com/v1',
  model: 'gemini-3-flash',
  enabled: true,
  apiKey: 'test-key-a'
}
const profileB = {
  displayName: 'Relay B',
  sourceKind: 'custom-proxy' as const,
  protocolId: 'openai-chat-completions' as const,
  endpoint: 'https://relay-b.example.com',
  model: 'claude-sonnet-4-5',
  enabled: true,
  apiKey: 'test-key-a'
}

describe('multi-source provider profiles', () => {
  it('migrates the legacy provider table without losing profiles or their meaning', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-migration-'))
    const path = join(directory, 'morrow.sqlite3')
    const raw = new DatabaseSync(path)
    try {
      applyMigrations(raw, 47)
      raw.prepare("INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, updated_at) VALUES ('deepseek', 'remote', 'https://api.deepseek.com', 'deepseek-flash', 1, ?)")
        .run('2026-10-01T00:00:00.000Z')
      raw.prepare("INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, updated_at) VALUES ('spark', 'remote', 'https://maas-api.cn-huabei-1.xf-yun.com/v2', 'spark-x2.6', 0, ?)")
        .run('2026-10-01T00:00:00.000Z')
      raw.prepare("INSERT INTO provider_profiles(id, provider_class, endpoint, model, enabled, updated_at) VALUES ('local-openai', 'local', 'http://127.0.0.1:1234', 'qwen2.5', 0, ?)")
        .run('2026-10-01T00:00:00.000Z')
      expect(applyMigrations(raw)).toBe(49)
    } finally {
      raw.close()
    }
    const database = SqliteDatabase.open(path)
    try {
      const service = new ProviderConfigService(database, new MemorySecretStore(), async () => undefined)
      const profiles = service.listProfiles()
      expect(profiles).toHaveLength(3)
      expect(profiles.find((item) => item.id === 'deepseek')).toMatchObject({
        displayName: 'DeepSeek',
        sourceKind: 'official',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        enabled: true,
        isDefault: false
      })
      expect(profiles.find((item) => item.id === 'spark')).toMatchObject({ sourceKind: 'official', enabled: false })
      expect(profiles.find((item) => item.id === 'local-openai')).toMatchObject({ sourceKind: 'local', providerClass: 'local' })
    } finally {
      database.close()
    }
  })

  it('creates two isolated profiles, switches the default and deletes only one', () => {
    const { database, service, secrets } = openService()
    try {
      const a = service.saveProfile(profileA)
      const b = service.saveProfile(profileB)
      expect(a.id).not.toBe(b.id)
      expect(secrets.get(a.id)).toBe(profileA.apiKey)
      expect(secrets.get(b.id)).toBe(profileB.apiKey)
      expect(service.listProfiles()).toHaveLength(2)

      service.setDefaultProfile(a.id)
      expect(service.getDefault()?.id).toBe(a.id)
      service.setDefaultProfile(b.id)
      expect(service.getDefault()?.id).toBe(b.id)
      expect(service.get(a.id)?.isDefault).toBe(false)

      service.deleteProfile(a.id)
      expect(service.get(a.id)).toBeNull()
      expect(secrets.get(a.id)).toBeUndefined()
      expect(service.get(b.id)).toMatchObject({ id: b.id, isDefault: true })
    } finally {
      database.close()
    }
  })

  it('rejects unsafe or unsupported profiles', () => {
    const { database, service } = openService()
    try {
      const { apiKey: _key, ...base } = profileA
      expect(() => service.saveProfile({ ...base, endpoint: 'http://relay.example.com' })).toThrow()
      expect(() => service.saveProfile({ ...base, endpoint: 'https://localhost' })).toThrow()
      expect(() => service.saveProfile({ ...base, endpoint: 'https://127.0.0.1' })).toThrow()
      expect(() => service.saveProfile({ ...base, endpoint: 'https://10.0.0.9' })).toThrow()
      expect(() => service.saveProfile({ ...base, sourceKind: 'private-network' })).toThrow()
      expect(() => service.saveProfile({ ...base, protocolId: 'anthropic-messages' as never })).toThrow()
      expect(() => service.saveProfile({ ...base, endpointPath: 'v1/chat' })).toThrow()
      expect(() => service.saveProfile({ ...base, model: 'bad model' })).toThrow()
      expect(() => service.saveProfile({ ...base, sourceKind: 'official' })).toThrow()
      expect(() => service.saveProfile({ ...base, profileId: 'deepseek', sourceKind: 'custom-proxy', endpoint: 'https://evil.example.com' })).toThrow()
      expect(() => service.saveProfile({ ...base, profileId: 'spark', sourceKind: 'custom-proxy', endpoint: 'https://evil.example.com' })).toThrow()
      expect(service.listProfiles()).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it('tests a custom profile through the product adapter and records sanitized health', async () => {
    const { database, service, previews } = openService()
    try {
      const saved = service.saveProfile(profileA)
      const result = await service.testConnection({ providerId: saved.id })
      expect(result).toMatchObject({ providerId: saved.id, model: 'gemini-3-flash', connected: true, status: 'connected' })
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(previews).toHaveLength(1)
      expect(previews[0]?.endpoint).toBe('https://relay-a.example.com/v1/chat/completions')
      expect(previews[0]?.model).toBe('gemini-3-flash')
      const stored = service.get(saved.id)!
      expect(stored.lastTest).toMatchObject({ status: 'connected', model: 'gemini-3-flash' })
      service.setDefaultProfile(saved.id)
      const { apiKey: _ignored, ...baseProfile } = profileA
      const renamed = service.saveProfile({ ...baseProfile, profileId: saved.id, displayName: 'Relay A renamed' })
      expect(renamed.lastTest).toMatchObject({ status: 'connected' })
      expect(renamed.isDefault).toBe(true)
      const undefaulted = service.saveProfile({ ...baseProfile, profileId: saved.id, isDefault: false })
      expect(undefaulted.isDefault).toBe(false)
      expect(stored.capabilities?.streaming.verified).toBe(true)
      expect(JSON.stringify(stored.lastTest)).not.toContain(profileA.apiKey)
    } finally {
      database.close()
    }
  })

  it('discovers models without making discovery mandatory', async () => {
    const { database, service, fetcher } = openService()
    try {
      const saved = service.saveProfile(profileA)
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'gemini-3-flash' }, { id: 'claude-sonnet-4-5' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
      const result = await service.discoverModels({ profileId: saved.id })
      expect(result.models).toEqual(['gemini-3-flash', 'claude-sonnet-4-5'])
      expect(fetcher).toHaveBeenCalledWith('https://relay-a.example.com/v1/models', expect.objectContaining({ method: 'GET', redirect: 'error' }))
    } finally {
      database.close()
    }
  })

  it('requires consent before model discovery', async () => {
    const { database, secrets, fetcher } = openService()
    try {
      const denied = new ProviderConfigService(
        database,
        secrets,
        async () => undefined,
        () => '2026-11-04T00:00:00.000Z',
        () => { throw new Error('provider factory must not run during denied discovery') },
        fetcher as never,
        createEndpointPolicy(async () => [{ address: '8.8.8.8' }])
      )
      const saved = denied.saveProfile(profileA)
      await expect(denied.discoverModels({ profileId: saved.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })

  it('binds consent to the profile endpoint and payload', () => {
    const { database, service } = openService()
    try {
      const saved = service.saveProfile(profileA)
      const config = service.get(saved.id)!
      const inputA = {
        prompt: 'x',
        context: { text: '', selected: [], omitted: 0, characterCount: 0 },
        endpoint: 'https://relay-a.example.com/v1/chat/completions',
        maximumSensitivity: 'normal' as const,
        requestPayload: { model: config.model, messages: [{ role: 'user', content: 'x' }], stream: true }
      }
      const preview = consentPreview('chat', config, inputA)
      const consent = approve(preview)
      const profile = { id: config.id, providerClass: config.providerClass, configured: true }
      expect(assessProviderRequest(profile, inputA, consent).allowed).toBe(true)
      const inputB = { ...inputA, endpoint: 'https://relay-b.example.com/chat/completions' }
      expect(assessProviderRequest(profile, inputB, consent)).toMatchObject({ allowed: false, reason: 'invalid_consent' })
      expect(assessProviderRequest({ ...profile, id: 'other-profile' }, inputA, consent)).toMatchObject({ allowed: false, reason: 'invalid_consent' })
    } finally {
      database.close()
    }
  })

  it('blocks a custom endpoint whose request-time DNS answer is private', async () => {
    const { database, secrets } = openService()
    try {
      const policy = createEndpointPolicy(async () => [{ address: '10.0.0.7' }])
      const config = {
        id: 'custom-profile',
        displayName: 'Rebinding relay',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        providerClass: 'remote',
        endpoint: 'https://rebind.example.com',
        endpointPath: null,
        model: 'gemini-3-flash',
        enabled: true,
        isDefault: false,
        apiKeyConfigured: true,
        updatedAt: '2026-11-04T00:00:00.000Z'
      } as ProviderConfigRecord
      secrets.set(config.id, 'key-0123456789abcdef')
      const provider = new OpenAICompatibleProvider(config, secrets, async () => new Response('{}'), 2_000, { maxAttempts: 1 }, policy)
      await expect(provider.generate({
        prompt: 'x',
        context: { text: '', selected: [], omitted: 0, characterCount: 0 },
        endpoint: 'https://rebind.example.com/chat/completions',
        maximumSensitivity: 'normal',
        requestPayload: { model: 'gemini-3-flash', messages: [{ role: 'user', content: 'x' }], stream: false }
      })).rejects.toMatchObject({ code: 'PROVIDER_ENDPOINT_BLOCKED' })
    } finally {
      database.close()
    }
  })
})

describe('provider health classification', () => {
  it('records auth and model failures without storing the response body', async () => {
    const { database, service, fetcher } = openService()
    try {
      const saved = service.saveProfile(profileA)
      fetcher.mockResolvedValueOnce(new Response('{"error":{"message":"bad key"}}', { status: 401 }))
      await expect(service.testConnection({ providerId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })
      expect(service.get(saved.id)?.lastTest).toMatchObject({ status: 'auth_failed' })
      expect(JSON.stringify(service.get(saved.id)?.lastTest)).not.toContain('bad key')

      fetcher.mockResolvedValueOnce(new Response('{"error":{"code":"pre_consume_token_quota_failed","type":"new_api_error"}}', { status: 403 }))
      await expect(service.testConnection({ providerId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_QUOTA' })
      expect(service.get(saved.id)?.lastTest).toMatchObject({ status: 'quota' })

      fetcher.mockResolvedValueOnce(new Response('{"error":{"message":"no model"}}', { status: 404 }))
      await expect(service.testConnection({ providerId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_MODEL' })
      expect(service.get(saved.id)?.lastTest).toMatchObject({ status: 'model_not_found' })
      expect(JSON.stringify(service.get(saved.id)?.lastTest)).not.toContain('no model')
    } finally {
      database.close()
    }
  })
})

describe('provider schema identity', () => {
  it('fails closed when a v48 database has another implementation line identity', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-foreign-'))
    const path = join(directory, 'morrow.sqlite3')
    const raw = new DatabaseSync(path)
    try {
      applyMigrations(raw, 47)
      raw.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (48, 'foreign-v48-line', '2026-11-04T00:00:00.000Z')").run()
    } finally {
      raw.close()
    }
    expect(() => SqliteDatabase.open(path)).toThrow('Local storage could not be opened.')
  })

  it('fails closed when a known v48 name does not match the table structure', () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-structural-'))
    const path = join(directory, 'morrow.sqlite3')
    const raw = new DatabaseSync(path)
    try {
      applyMigrations(raw, 47)
      raw.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (48, 'pending-decision-terminal-state', '2026-11-04T00:00:00.000Z')").run()
    } finally {
      raw.close()
    }
    expect(() => SqliteDatabase.open(path)).toThrow('Local storage could not be opened.')
  })
})

describe('provider profile change semantics', () => {
  it('invalidates health and verified capabilities for each connection-semantic change', async () => {
    const { database, service, secrets } = openService()
    try {
      const saved = service.saveProfile(profileA)
      await service.testConnection({ providerId: saved.id })
      expect(service.get(saved.id)).toMatchObject({
        lastTest: { status: 'connected' },
        capabilities: { streaming: { verified: true } }
      })
      const { apiKey: _key, ...base } = profileA
      const renamed = service.saveProfile({ ...base, profileId: saved.id, displayName: 'Relay A renamed' })
      expect(renamed.lastTest?.status).toBe('connected')
      expect(renamed.capabilities?.streaming.verified).toBe(true)

      const modelChanged = service.saveProfile({ ...base, profileId: saved.id, model: 'claude-sonnet-4-5' })
      expect(modelChanged.lastTest).toBeNull()
      expect(modelChanged.capabilities?.streaming.verified).toBe(false)
      expect(modelChanged.apiKeyConfigured).toBe(true)

      await service.testConnection({ providerId: saved.id })
      expect(service.get(saved.id)?.lastTest?.status).toBe('connected')
      const endpointChanged = service.saveProfile({
        ...base,
        profileId: saved.id,
        model: 'claude-sonnet-4-5',
        endpoint: 'https://relay-c.example.com'
      })
      expect(endpointChanged.lastTest).toBeNull()
      expect(endpointChanged.capabilities?.streaming.verified).toBe(false)
      expect(endpointChanged.enabled).toBe(false)
      expect(endpointChanged.apiKeyConfigured).toBe(false)
      expect(secrets.get(saved.id)).toBeUndefined()

      const rekeyed = service.saveProfile({
        ...base,
        profileId: saved.id,
        model: 'claude-sonnet-4-5',
        endpoint: 'https://relay-c.example.com',
        apiKey: 'test-key-a'
      })
      expect(rekeyed.enabled).toBe(true)
      await service.testConnection({ providerId: saved.id })
      const pathChanged = service.saveProfile({
        ...base,
        profileId: saved.id,
        model: 'claude-sonnet-4-5',
        endpoint: 'https://relay-c.example.com',
        endpointPath: '/v1',
        apiKey: 'test-key-a'
      })
      expect(pathChanged.lastTest).toBeNull()
      expect(pathChanged.apiKeyConfigured).toBe(true)
      expect(secrets.get(saved.id)).toBe(profileA.apiKey)

      await service.testConnection({ providerId: saved.id })
      const localChanged = service.saveProfile({
        ...base,
        profileId: saved.id,
        model: 'local-model',
        sourceKind: 'local',
        endpoint: 'http://127.0.0.1:1234'
      })
      expect(localChanged.lastTest).toBeNull()
      expect(localChanged.apiKeyConfigured).toBe(false)
      expect(secrets.get(saved.id)).toBeUndefined()

      await service.testConnection({ providerId: saved.id })
      const newKey = service.saveProfile({
        ...base,
        profileId: saved.id,
        model: 'gemini-3-flash',
        endpoint: 'https://relay-d.example.com',
        apiKey: 'key-0123456789abcdef'
      })
      expect(newKey.lastTest).toBeNull()
      expect(newKey.capabilities?.streaming.verified).toBe(false)
      expect(secrets.get(saved.id)).toBe('key-0123456789abcdef')
    } finally {
      database.close()
    }
  })

  it('sends the connection test to the exact chat URL for every supported shape', async () => {
    const { database, service, fetcher } = openService()
    try {
      const cases = [
        { endpoint: 'https://relay.example.com', expected: 'https://relay.example.com/chat/completions' },
        { endpoint: 'https://relay.example.com/v1', expected: 'https://relay.example.com/v1/chat/completions' },
        { endpoint: 'https://relay.example.com/v1/chat/completions', expected: 'https://relay.example.com/v1/chat/completions' },
        { endpoint: 'https://relay.example.com', endpointPath: '/v1/chat/completions', expected: 'https://relay.example.com/v1/chat/completions' },
        { endpoint: 'https://relay.example.com', endpointPath: '/v1', expected: 'https://relay.example.com/v1/chat/completions' },
        { endpoint: 'https://relay.example.com/v1/', endpointPath: '/v1', expected: 'https://relay.example.com/v1/chat/completions' }
      ]
      for (const [index, item] of cases.entries()) {
        const { expected, ...shape } = item
        const saved = service.saveProfile({ ...profileA, ...shape, displayName: `Shape ${index}`, apiKey: 'test-key-a' })
        await service.testConnection({ providerId: saved.id })
        expect(fetcher.mock.calls.at(-1)?.[0]).toBe(expected)
      }
    } finally {
      database.close()
    }
  })

  it('rejects official profile overrides at the service layer', () => {
    const { database, service } = openService()
    try {
      const official = {
        profileId: 'deepseek',
        displayName: 'DeepSeek',
        sourceKind: 'official' as const,
        protocolId: 'openai-chat-completions' as const,
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        enabled: true,
        apiKey: 'test-key-a'
      }
      expect(service.saveProfile(official).id).toBe('deepseek')
      expect(() => service.saveProfile({ ...official, endpointPath: '/v1' })).toThrow()
      expect(() => service.saveProfile({ ...official, endpoint: 'https://evil.example.com' })).toThrow()
      expect(() => service.saveProfile({ ...official, sourceKind: 'local' })).toThrow()
      expect(() => service.saveProfile({ ...official, model: 'spark-x2.6' })).toThrow()
      expect(() => service.saveProfile({ ...official, profileId: 'local-openai' })).toThrow()
      expect(() => service.saveProfile({
        ...official,
        profileId: 'spark',
        endpoint: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
        model: 'spark-x2.6'
      })).not.toThrow()
      expect(service.get('deepseek')?.endpointPath).toBeNull()
    } finally {
      database.close()
    }
  })

  it('restores the previous secret when the replacement write fails', async () => {
    const delegate = new MemorySecretStore()
    let failNextSet = false
    const flaky: SecretStore = {
      isAvailable: () => delegate.isAvailable(),
      get: (id) => delegate.get(id),
      delete: (id) => delegate.delete(id),
      set: (id, value) => {
        if (failNextSet) {
          failNextSet = false
          throw new SecretStoreError('write_failed')
        }
        delegate.set(id, value)
      }
    }
    const { database, service } = openService(flaky)
    try {
      const saved = service.saveProfile(profileA)
      await service.testConnection({ providerId: saved.id })
      failNextSet = true
      expect(() => service.saveProfile({
        ...profileA,
        profileId: saved.id,
        endpoint: 'https://relay-z.example.com',
        apiKey: 'test-key-b'
      })).toThrow('PROVIDER_STORAGE_UNAVAILABLE')
      expect(delegate.get(saved.id)).toBe(profileA.apiKey)
      expect(service.get(saved.id)).toMatchObject({
        endpoint: profileA.endpoint,
        lastTest: { status: 'connected' }
      })
    } finally {
      database.close()
    }
  })
})

describe('model discovery hardening', () => {
  it('uses a dedicated discovery consent action', async () => {
    const { database, service, previews, fetcher } = openService()
    try {
      const saved = service.saveProfile(profileA)
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'gemini-3-flash' }] }), { status: 200 }))
      await service.discoverModels({ profileId: saved.id })
      expect(previews.at(-1)?.action).toBe('model-discovery')
    } finally {
      database.close()
    }
  })

  it('blocks before consent and fetch when the endpoint policy rejects', async () => {
    const { database, secrets, fetcher } = openService()
    try {
      const previews: ProviderConsentPreview[] = []
      const blocked = new ProviderConfigService(
        database,
        secrets,
        async (preview) => { previews.push(preview); return approve(preview) },
        () => '2026-11-04T00:00:00.000Z',
        () => { throw new Error('provider factory must not run') },
        fetcher as never,
        createEndpointPolicy(async () => { throw new Error('dns down') })
      )
      const saved = blocked.saveProfile(profileA)
      await expect(blocked.discoverModels({ profileId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_ENDPOINT_BLOCKED' })
      expect(previews).toHaveLength(0)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })

  it('refuses an oversized discovery body without trusting Content-Length', async () => {
    const { database, service, fetcher } = openService()
    try {
      const saved = service.saveProfile(profileA)
      const oversized = new Uint8Array(1_048_577).fill(97)
      fetcher.mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) { controller.enqueue(oversized); controller.close() }
      }), { status: 200 }))
      await expect(service.discoverModels({ profileId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
    } finally {
      database.close()
    }
  })

  it('refuses an oversized discovery body', async () => {
    const { database, service, fetcher } = openService()
    try {
      const saved = service.saveProfile(profileA)
      fetcher.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-length': '1000001' } }))
      await expect(service.discoverModels({ profileId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
    } finally {
      database.close()
    }
  })
})

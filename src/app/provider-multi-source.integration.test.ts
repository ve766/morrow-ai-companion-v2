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
import { MemorySecretStore } from '../security/secrets'
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

function openService(): {
  database: SqliteDatabase
  service: ProviderConfigService
  secrets: MemorySecretStore
  previews: ProviderConsentPreview[]
  fetcher: ReturnType<typeof vi.fn>
} {
  directory = mkdtempSync(join(tmpdir(), 'morrow-multi-provider-'))
  const database = SqliteDatabase.open(join(directory, 'morrow.sqlite3'))
  const secrets = new MemorySecretStore()
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
      expect(applyMigrations(raw)).toBe(48)
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

      fetcher.mockResolvedValueOnce(new Response('{"error":{"message":"no model"}}', { status: 404 }))
      await expect(service.testConnection({ providerId: saved.id })).rejects.toMatchObject({ code: 'PROVIDER_MODEL' })
      expect(service.get(saved.id)?.lastTest).toMatchObject({ status: 'model_not_found' })
      expect(JSON.stringify(service.get(saved.id)?.lastTest)).not.toContain('no model')
    } finally {
      database.close()
    }
  })
})

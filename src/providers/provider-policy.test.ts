import { describe, expect, it, vi } from 'vitest'
import type { AssembledMemoryContext } from '../shared/companion'
import {
  MAX_PROVIDER_PAYLOAD_BYTES,
  assessProviderRequest,
  consentPreview,
  dispatchToProvider,
  hashProviderInput,
  type ProviderConsent,
  type ProviderInput,
  type ProviderPort,
  type ProviderProfile
} from './provider-policy'

const now = '2026-10-23T00:00:00.000Z'
const profile: ProviderProfile = { id: 'deepseek', providerClass: 'remote', configured: true }
const providerMeta = { id: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' }

function context(selected: AssembledMemoryContext['selected'] = []): AssembledMemoryContext {
  return { text: '', selected, omitted: 0, characterCount: 0 }
}

function input(body: unknown = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hello' }] }, memories: AssembledMemoryContext['selected'] = []): ProviderInput {
  return {
    prompt: 'hello',
    context: context(memories),
    endpoint: providerMeta.endpoint,
    maximumSensitivity: 'personal',
    requestPayload: body
  }
}

function consentFor(value: ProviderInput, includeSensitive = false): ProviderConsent {
  const preview = consentPreview('chat', providerMeta, value)
  return {
    providerId: preview.providerId,
    payloadSha256: preview.payloadSha256,
    approvedAt: now,
    expiresAt: '2026-10-23T00:02:00.000Z',
    includeSensitive
  }
}

describe('exact provider egress policy', () => {
  it('uses stable payload hashing and requires a fresh provider-bound exact-payload approval', () => {
    const first = input({ messages: [{ content: 'hello', role: 'user' }], model: 'deepseek-flash' })
    const same = input({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hello' }] })
    expect(hashProviderInput(first)).toBe(hashProviderInput(same))
    expect(assessProviderRequest(profile, first, undefined, now)).toEqual({ allowed: false, reason: 'consent_required' })
    expect(assessProviderRequest(profile, first, consentFor(first), now)).toMatchObject({ allowed: true })
    expect(assessProviderRequest({ ...profile, configured: false }, first, consentFor(first), now))
      .toEqual({ allowed: false, reason: 'unconfigured' })
  })

  it('rejects expired, altered, wrong-provider, and overlong approvals', () => {
    const value = input()
    const approved = consentFor(value)
    expect(assessProviderRequest(profile, value, { ...approved, expiresAt: now }, now))
      .toEqual({ allowed: false, reason: 'invalid_consent' })
    expect(assessProviderRequest(profile, input({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'changed' }] }), approved, now))
      .toEqual({ allowed: false, reason: 'invalid_consent' })
    expect(assessProviderRequest(profile, value, { ...approved, providerId: 'other' }, now))
      .toEqual({ allowed: false, reason: 'invalid_consent' })
    expect(assessProviderRequest(profile, value, { ...approved, expiresAt: '2026-10-23T00:06:00.000Z' }, now))
      .toEqual({ allowed: false, reason: 'invalid_consent' })
    expect(assessProviderRequest(profile, input({ content: 'x'.repeat(MAX_PROVIDER_PAYLOAD_BYTES) }), consentFor(value), now))
      .toEqual({ allowed: false, reason: 'payload_too_large' })
  })

  it('requires an explicit sensitive-data approval and never dispatches denied payloads', async () => {
    const secretMemory = { id: 'm-1', content: 'Sensitive health detail.', sourceCategory: 'user_explicit_input' as const, confidence: 85, sensitivity: 'sensitive' as const, updatedAt: now, revision: 1, score: 1, match: 'topic' as const }
    const value = input(undefined, [secretMemory])
    const basicConsent = consentFor(value)
    expect(assessProviderRequest(profile, value, basicConsent, now))
      .toEqual({ allowed: false, reason: 'sensitive_context_not_approved' })
    expect(assessProviderRequest(profile, value, consentFor(value, true), now)).toMatchObject({ allowed: true, maximumSensitivity: 'sensitive' })

    const generate = vi.fn(async () => ({ text: 'should not run', modelId: 'deepseek-flash' }))
    const port: ProviderPort = { profile, generate }
    await expect(dispatchToProvider(port, value, basicConsent, now)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not let the local provider class bypass exact egress approval', async () => {
    const generate = vi.fn(async () => ({ text: 'local answer', modelId: 'local-test' }))
    const local: ProviderPort = {
      profile: { id: 'local-test', providerClass: 'local', configured: true },
      generate
    }
    const loopback = input(undefined, [])
    const loopbackInput: ProviderInput = { ...loopback, endpoint: 'http://127.0.0.1:8080/v1/chat/completions' }
    await expect(dispatchToProvider(local, loopbackInput, undefined, now)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(generate).not.toHaveBeenCalled()

    const preview = consentPreview('chat', { id: 'local-test', endpoint: loopbackInput.endpoint, model: 'local-test' }, loopbackInput)
    const consent: ProviderConsent = {
      providerId: preview.providerId,
      payloadSha256: preview.payloadSha256,
      approvedAt: now,
      expiresAt: '2026-10-23T00:02:00.000Z',
      includeSensitive: false
    }
    await expect(dispatchToProvider(local, loopbackInput, consent, now)).resolves.toEqual({ text: 'local answer', modelId: 'local-test' })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('fails closed when a local provider targets anything that is not a literal loopback endpoint', () => {
    const local: ProviderProfile = { id: 'local-test', providerClass: 'local', configured: true }
    const rejectedEndpoints = [
      'http://example.com/v1/chat/completions',
      'http://10.0.0.4:8080/v1/chat/completions',
      'http://192.168.1.2:8080/v1/chat/completions',
      'https://api.deepseek.com/chat/completions',
      'http://[::2]:8080/v1/chat/completions',
      'http://[::ffff:127.0.0.1]:8080/v1/chat/completions',
      'http://0.0.0.0:8080/v1/chat/completions',
      'http://169.254.169.254/latest/meta-data',
      'http://my-local-host.example/v1/chat/completions',
      'http://localhost.example/v1/chat/completions',
      'ftp://127.0.0.1:9000/v1/chat/completions',
      'file:///etc/passwd',
      'http://user:password@127.0.0.1:8080/v1/chat/completions',
      'http://127.0.0.1:8080@evil.example/v1/chat/completions',
      'not a url at all',
      '//127.0.0.1:8080/v1/chat/completions',
      'http://127.0.0.256:8080/v1/chat/completions'
    ]
    for (const endpoint of rejectedEndpoints) {
      const value: ProviderInput = { ...input(), endpoint }
      expect(assessProviderRequest(local, value, undefined, now), `must reject ${endpoint}`)
        .toEqual({ allowed: false, reason: 'endpoint_not_local' })
    }
    const allowedEndpoints = [
      'http://localhost:1234/v1/chat/completions',
      'http://127.0.0.1:8080/v1/chat/completions',
      'http://127.8.15.9:8080/v1/chat/completions',
      'http://127.0.0.2:8080/v1/chat/completions',
      'http://[::1]:8080/v1/chat/completions',
      'https://localhost:8443/v1/chat/completions'
    ]
    for (const endpoint of allowedEndpoints) {
      const value: ProviderInput = { ...input(), endpoint }
      // Loopback endpoints pass the locality gate and then hit the same
      // exact-consent gate as every other provider class.
      expect(assessProviderRequest(local, value, undefined, now), `must not fail closed for ${endpoint}`)
        .toEqual({ allowed: false, reason: 'consent_required' })
    }
  })

  it('keeps remote-class dispatch unchanged: loopback endpoints still require exact consent', () => {
    const value: ProviderInput = { ...input(), endpoint: 'http://127.0.0.1:8080/v1/chat/completions' }
    expect(assessProviderRequest(profile, value, undefined, now)).toEqual({ allowed: false, reason: 'consent_required' })
    expect(assessProviderRequest(profile, value, consentFor(value), now)).toMatchObject({ allowed: true })
  })

  it('rejects loopback and non-loopback local endpoints identically when consent is stale or mismatched', () => {
    const local: ProviderProfile = { id: 'local-test', providerClass: 'local', configured: true }
    const loopback: ProviderInput = { ...input(), endpoint: 'http://127.0.0.1:8080/v1/chat/completions' }
    const stale = consentPreview('chat', { id: 'local-test', endpoint: loopback.endpoint, model: 'local-test' }, loopback)
    expect(assessProviderRequest(local, loopback, { ...stale, payloadSha256: '0'.repeat(64), approvedAt: now, expiresAt: '2026-10-23T00:02:00.000Z', providerId: 'local-test', includeSensitive: false }, now))
      .toEqual({ allowed: false, reason: 'invalid_consent' })
  })

  it('hands the provider exactly the payload that was previewed, with no field added afterwards', async () => {
    const value = input({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hello' }], max_tokens: 10 })
    const preview = consentPreview('chat', providerMeta, value)
    expect(preview.payloadSha256).toBe(hashProviderInput(value))
    expect(preview.model).toBe(providerMeta.model)
    expect(preview.endpoint).toBe(providerMeta.endpoint)
    expect(preview.exactPayload).toContain('"content":"hello"')

    const received: unknown[] = []
    const port: ProviderPort = {
      profile,
      generate: async (given) => {
        received.push(given.requestPayload)
        return { text: 'ok', modelId: 'deepseek-flash' }
      }
    }
    await dispatchToProvider(port, value, consentFor(value), now)
    expect(JSON.stringify(received[0])).toBe(JSON.stringify(value.requestPayload))
  })

  it('binds the approval to the endpoint as well as the messages', () => {
    const value = input()
    const consent = consentFor(value)
    const moved: ProviderInput = { ...value, endpoint: 'http://127.0.0.1:11434/v1/chat/completions' }
    const local: ProviderProfile = { id: 'deepseek', providerClass: 'local', configured: true }
    // Same messages, different destination: the approval must not survive.
    expect(hashProviderInput(moved)).not.toBe(hashProviderInput(value))
    expect(assessProviderRequest(local, moved, consent, now)).toEqual({ allowed: false, reason: 'invalid_consent' })
  })

  it('does not extend an approval past its own lifetime', () => {
    const value = input()
    const approved = consentFor(value)
    const justBefore = '2026-10-23T00:01:59.999Z'
    const justAfter = '2026-10-23T00:02:00.001Z'
    expect(assessProviderRequest(profile, value, approved, justBefore)).toMatchObject({ allowed: true })
    expect(assessProviderRequest(profile, value, approved, justAfter)).toEqual({ allowed: false, reason: 'invalid_consent' })
  })
})

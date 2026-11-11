import { describe, expect, it } from 'vitest'
import { isProviderUsable, selectChatProvider } from '../src/renderer/src/provider-readiness'
import type { ProviderConfigRecord } from '../src/shared/companion'

function profile(overrides: Partial<ProviderConfigRecord> & Pick<ProviderConfigRecord, 'id'>): ProviderConfigRecord {
  return {
    displayName: overrides.id,
    sourceKind: 'custom-proxy',
    protocolId: 'openai-chat-completions',
    providerClass: 'remote',
    endpoint: 'https://relay.example.com',
    endpointPath: null,
    model: 'gemini-3-flash',
    enabled: true,
    isDefault: false,
    apiKeyConfigured: true,
    updatedAt: '2026-11-05T00:00:00.000Z',
    ...overrides
  }
}

describe('provider readiness', () => {
  it('accepts a local loopback profile without a credential', () => {
    expect(isProviderUsable(profile({ id: 'local-openai', sourceKind: 'local', providerClass: 'local', endpoint: 'http://127.0.0.1:1234', apiKeyConfigured: false }))).toBe(true)
  })

  it('rejects a remote profile without a credential or while disabled', () => {
    expect(isProviderUsable(profile({ id: 'custom-a', apiKeyConfigured: false }))).toBe(false)
    expect(isProviderUsable(profile({ id: 'custom-a', enabled: false }))).toBe(false)
    expect(isProviderUsable(null)).toBe(false)
  })

  it('mirrors the service order: default, local, spark, deepseek, custom', () => {
    const custom = profile({ id: 'custom-a' })
    const local = profile({ id: 'local-openai', sourceKind: 'local', providerClass: 'local', endpoint: 'http://127.0.0.1:1234', apiKeyConfigured: false })
    const spark = profile({ id: 'spark', sourceKind: 'official', providerClass: 'remote', endpoint: 'https://maas-api.cn-huabei-1.xf-yun.com/v2', apiKeyConfigured: true })
    const deepseek = profile({ id: 'deepseek', sourceKind: 'official', endpoint: 'https://api.deepseek.com', apiKeyConfigured: true })
    const chosenDefault = profile({ id: 'chosen', isDefault: true })
    expect(selectChatProvider([custom, local, spark, deepseek, chosenDefault])?.id).toBe('chosen')
    expect(selectChatProvider([custom, local, spark, deepseek])?.id).toBe('local-openai')
    expect(selectChatProvider([custom, spark, deepseek])?.id).toBe('spark')
    expect(selectChatProvider([custom, deepseek])?.id).toBe('deepseek')
    expect(selectChatProvider([custom])?.id).toBe('custom-a')
  })

  it('does not select a disabled default', () => {
    const disabledDefault = profile({ id: 'chosen', isDefault: true, enabled: false })
    const custom = profile({ id: 'custom-a' })
    expect(selectChatProvider([disabledDefault, custom])?.id).toBe('custom-a')
  })
})

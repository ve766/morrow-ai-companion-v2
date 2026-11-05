import { describe, expect, it } from 'vitest'
import { presentProviderConsent, sanitizeConsentEndpoint } from './consent-presentation'
import type { ProviderConsentPreview } from './provider-policy'

function preview(overrides: Partial<ProviderConsentPreview> = {}): ProviderConsentPreview {
  return {
    action: 'chat',
    providerId: 'custom-a',
    providerDisplayName: 'Relay A',
    providerSourceKind: 'custom-proxy',
    endpoint: 'https://relay.example.com/v1/chat/completions',
    model: 'gemini-3-flash',
    payloadSha256: 'a'.repeat(64),
    payloadBytes: 123,
    maximumSensitivity: 'normal',
    includedMemories: [],
    exactPayload: '{"endpoint":"https://relay.example.com"}',
    ...overrides
  }
}

describe('provider consent presentation', () => {
  it('names an official profile only by its own vendor and never invents a price', () => {
    const shown = presentProviderConsent(preview({
      providerId: 'deepseek',
      providerDisplayName: 'DeepSeek',
      providerSourceKind: 'official',
      endpoint: 'https://api.deepseek.com/chat/completions'
    }))
    expect(shown.providerLabel).toBe('DeepSeek')
    expect(shown.title).toContain('DeepSeek')
    expect(shown.pricing).toContain('计费信息未验证')
    expect(shown.pricing).not.toMatch(/按 token 计费/u)
  })

  it('labels a custom relay as a user-configured service, not an official vendor', () => {
    const shown = presentProviderConsent(preview())
    expect(shown.providerLabel).toBe('自定义服务端')
    expect(shown.providerKindLabel).toContain('relay.example.com')
    expect(shown.title).not.toContain('DeepSeek')
    expect(shown.message).not.toContain('DeepSeek')
    expect(shown.pricing).toContain('自行核验')
    expect(shown.warning).toContain('不是 Morrow 官方厂商')
  })

  it('labels a local profile as a loopback service with no API fee', () => {
    const shown = presentProviderConsent(preview({
      providerId: 'local-openai',
      providerDisplayName: 'Local OpenAI',
      providerSourceKind: 'local',
      endpoint: 'http://127.0.0.1:1234/v1/chat/completions'
    }))
    expect(shown.providerLabel).toBe('本地模型服务')
    expect(shown.pricing).toContain('不产生 API 费用')
    expect(shown.message).toContain('本机回环地址')
    expect(shown.title).not.toContain('DeepSeek')
  })

  it('strips credentials, query and fragment from the displayed endpoint', () => {
    expect(sanitizeConsentEndpoint('https://user:pass@relay.example.com/v1?token=secret#x'))
      .toBe('https://relay.example.com/v1')
    const shown = presentProviderConsent(preview({
      endpoint: 'https://user:pass@relay.example.com/v1?token=secret#x'
    }))
    expect(shown.target).toBe('https://relay.example.com/v1')
    expect(JSON.stringify(shown)).not.toContain('user:pass')
    expect(JSON.stringify(shown)).not.toContain('token=secret')
  })

  it('falls back to a custom service when profile metadata is missing', () => {
    const shown = presentProviderConsent(preview({
      providerId: 'unknown-profile',
      providerDisplayName: '',
      providerSourceKind: 'custom-proxy'
    }))
    expect(shown.providerLabel).toBe('自定义服务端')
    expect(shown.title).not.toContain('DeepSeek')
  })

  it('maps every action to its own label', () => {
    expect(presentProviderConsent(preview({ action: 'chat' })).actionLabel).toBe('发送对话')
    expect(presentProviderConsent(preview({ action: 'connection-test' })).actionLabel).toBe('测试连接')
    expect(presentProviderConsent(preview({ action: 'model-discovery' })).actionLabel).toBe('获取模型列表')
    expect(presentProviderConsent(preview({ action: 'memory-proposal' })).actionLabel).toBe('生成记忆候选')
  })
})

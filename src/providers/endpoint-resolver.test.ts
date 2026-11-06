import { describe, expect, it } from 'vitest'
import { resolveChatEndpoint, resolveModelsEndpoint, normalizeBaseUrl } from './endpoint-resolver'

describe('provider endpoint resolver', () => {
  it('appends the default path to a bare base', () => {
    expect(resolveChatEndpoint('https://relay.example.com')).toBe('https://relay.example.com/chat/completions')
    expect(resolveModelsEndpoint('https://relay.example.com')).toBe('https://relay.example.com/models')
  })

  it('keeps a versioned base and does not duplicate /v1', () => {
    expect(resolveChatEndpoint('https://relay.example.com/v1')).toBe('https://relay.example.com/v1/chat/completions')
    expect(resolveModelsEndpoint('https://relay.example.com/v1')).toBe('https://relay.example.com/v1/models')
    expect(resolveChatEndpoint('https://relay.example.com/v1', '/v1/chat/completions')).toBe('https://relay.example.com/v1/chat/completions')
    expect(resolveModelsEndpoint('https://relay.example.com/v1', '/v1/chat/completions')).toBe('https://relay.example.com/v1/models')
  })

  it('accepts a full chat URL as the base', () => {
    expect(resolveChatEndpoint('https://relay.example.com/v1/chat/completions')).toBe('https://relay.example.com/v1/chat/completions')
    expect(resolveModelsEndpoint('https://relay.example.com/v1/chat/completions')).toBe('https://relay.example.com/v1/models')
  })

  it('joins a custom endpoint path without duplicating the base prefix', () => {
    expect(resolveChatEndpoint('https://relay.example.com', '/api/chat/completions')).toBe('https://relay.example.com/api/chat/completions')
    expect(resolveChatEndpoint('https://relay.example.com/v1', '/api/chat/completions')).toBe('https://relay.example.com/v1/api/chat/completions')
    expect(resolveModelsEndpoint('https://relay.example.com', '/api/chat/completions')).toBe('https://relay.example.com/api/models')
  })

  it('rejects userinfo, query, fragment and non-http schemes', () => {
    expect(() => normalizeBaseUrl('https://user:secret@relay.example.com')).toThrow(/userinfo/)
    expect(() => normalizeBaseUrl('https://relay.example.com/?key=1')).toThrow(/query/)
    expect(() => normalizeBaseUrl('https://relay.example.com/#x')).toThrow(/fragment/)
    expect(() => normalizeBaseUrl('ftp://relay.example.com')).toThrow(/scheme/)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, LOCAL_PROVIDER_ID, type ProviderConfigRecord } from '../shared/companion'
import { isLoopbackEndpoint } from '../security/url-gate'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderInput } from './provider-policy'
import { OpenAICompatibleProvider } from './openai-compatible'

const config: ProviderConfigRecord = {
  id: 'deepseek',
  providerClass: 'remote',
  endpoint: DEEPSEEK_API_BASE_URL,
  model: DEEPSEEK_MODEL,
  enabled: true,
  apiKeyConfigured: true,
  updatedAt: '2026-10-23T00:00:00.000Z', timeoutMs: 45000, catalogVerified: false
}

function input(signal?: AbortSignal): ProviderInput {
  return {
    prompt: 'Hello',
    context: { text: '', selected: [], omitted: 0, characterCount: 0 },
    endpoint: `${DEEPSEEK_API_BASE_URL}/chat/completions`,
    maximumSensitivity: 'personal',
    requestPayload: {
      model: DEEPSEEK_MODEL,
      max_tokens: 100,
      stream: true,
      thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hello' }]
    },
    ...(signal ? { signal } : {})
  }
}

function eventStream(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function makeProvider(fetcher: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs = 45_000) {
  const secrets = new MemorySecretStore()
  secrets.set('deepseek', 'test-only-secret')
  return new OpenAICompatibleProvider(config, secrets, fetcher, timeoutMs)
}

describe('DeepSeek V4.1 Flash adapter', () => {
  it('streams OpenAI-compatible SSE deltas from the official HTTPS endpoint without putting the key in the body', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEEPSEEK_API_BASE_URL}/chat/completions`)
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-only-secret')
      const body = String(init?.body)
      expect(body).toContain('"model":"deepseek-flash"')
      expect(body).toContain('"stream":true')
      expect(body).not.toContain('test-only-secret')
      return eventStream([
        'data: {"model":"deepseek-flash","choices":[{"delta":{"content":"Hel',
        'lo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    })
    const provider = makeProvider(fetcher)
    const deltas: string[] = []
    await expect(provider.generate(input(), (delta) => deltas.push(delta)))
      .resolves.toEqual({ text: 'Hello world', modelId: 'deepseek-flash' })
    expect(deltas).toEqual(['Hello', ' world'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects empty and malformed responses without inventing a reply', async () => {
    const malformed = makeProvider(async () => eventStream(['data: {not-json}\n\n', 'data: [DONE]\n\n']))
    await expect(malformed.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
    const empty = makeProvider(async () => eventStream(['data: [DONE]\n\n']))
    await expect(empty.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
    const noBody = makeProvider(async () => new Response(null, { status: 200 }))
    await expect(noBody.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
  })

  it('rejects a truncated stream without a terminal marker', async () => {
    const truncated = makeProvider(async () => eventStream([
      `data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n`
    ]))
    await expect(truncated.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE' })
  })

  it('maps authentication and rate-limit responses to safe actionable error codes', async () => {
    const unauthorized = makeProvider(async () => new Response(null, { status: 401 }))
    await expect(unauthorized.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })
    const limited = makeProvider(async () => new Response(null, { status: 429 }))
    await expect(limited.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT' })
  })

  it('marks a loopback local provider configured without any credential and refuses remote endpoints', async () => {
    const localConfig: ProviderConfigRecord = {
      id: LOCAL_PROVIDER_ID,
      providerClass: 'local',
      endpoint: 'http://127.0.0.1:1234',
      model: 'test-local-model',
      enabled: true,
      apiKeyConfigured: false,
      updatedAt: '2026-10-25T00:00:00.000Z', timeoutMs: 45000, catalogVerified: false
    }
    const seenAuth: Array<string | null> = []
    const local = new OpenAICompatibleProvider(localConfig, new MemorySecretStore(), async (_url, init) => {
      seenAuth.push(new Headers(init?.headers).get('authorization'))
      return eventStream([
        `data: ${JSON.stringify({ model: 'test-local-model', choices: [{ delta: { content: 'ok' } }] })}\n\n`,
        'data: [DONE]\n\n'
      ])
    })
    expect(local.profile).toMatchObject({ id: LOCAL_PROVIDER_ID, providerClass: 'local', configured: true })
    const output = await local.generate({
      prompt: 'Hello',
      context: { text: '', selected: [], omitted: 0, characterCount: 0 },
      endpoint: 'http://127.0.0.1:1234/chat/completions',
      maximumSensitivity: 'personal',
      requestPayload: {
        model: 'test-local-model',
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'Hello' }]
      }
    })
    expect(output).toMatchObject({ text: 'ok', modelId: 'test-local-model' })
    expect(seenAuth).toEqual([null])

    const remoteConfig: ProviderConfigRecord = { ...localConfig, endpoint: 'https://api.example.com' }
    expect(new OpenAICompatibleProvider(remoteConfig, new MemorySecretStore()).profile.configured).toBe(false)
    expect(isLoopbackEndpoint(remoteConfig.endpoint)).toBe(false)
  })

  it('separates caller cancellation from the request timeout', async () => {
    const waitForAbort = (_url: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
      else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    const controller = new AbortController()
    const cancelled = makeProvider(waitForAbort)
    const pending = cancelled.generate(input(controller.signal))
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
    const timedOut = makeProvider(waitForAbort, 5)
    await expect(timedOut.generate(input())).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
  })
})

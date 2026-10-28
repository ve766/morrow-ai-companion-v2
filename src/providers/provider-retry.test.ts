import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, type ProviderConfigRecord } from '../shared/companion'
import { MemorySecretStore } from '../security/secrets'
import type { ProviderInput } from './provider-policy'
import { OpenAICompatibleProvider } from './openai-compatible'

/**
 * Phase 2.3 B: bounded retry.
 *
 * The rules under test: retry only transient failures, never auth/quota/model
 * or a cancel; honour Retry-After within a cap; a stream that already emitted
 * text is never replayed.
 */

const config: ProviderConfigRecord = {
  id: 'deepseek',
  providerClass: 'remote',
  endpoint: DEEPSEEK_API_BASE_URL,
  model: DEEPSEEK_MODEL,
  enabled: true,
  apiKeyConfigured: true,
  updatedAt: '2026-10-23T00:00:00.000Z'
}

const input: ProviderInput = {
  prompt: 'Hello',
  context: { text: '', selected: [], omitted: 0, characterCount: 0 },
  endpoint: `${DEEPSEEK_API_BASE_URL}/chat/completions`,
  maximumSensitivity: 'personal',
  requestPayload: { model: DEEPSEEK_MODEL, max_tokens: 32, stream: false, messages: [{ role: 'user', content: 'Hello' }] }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

const ok = () => jsonResponse({ model: DEEPSEEK_MODEL, choices: [{ message: { content: 'pong' } }] })

function providerWith(
  sequence: Array<Response | Error>,
  options: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {}
) {
  const fetcher = vi.fn(async () => {
    const next = sequence.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  const secrets = new MemorySecretStore()
  secrets.set('deepseek', 'test-only-secret')
  const provider = new OpenAICompatibleProvider(config, secrets, fetcher, 45_000, {
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: 1,
    maxDelayMs: 5,
    sleep: options.sleep ?? (async () => {})
  })
  return { provider, fetcher }
}

describe('phase 2.3 B: provider retry', () => {
  it('retries a transient network failure and succeeds', async () => {
    const { provider, fetcher } = providerWith([new Error('ECONNRESET'), ok()])
    const output = await provider.generate(input)
    expect(output.text).toBe('pong')
    expect(output.attempts).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries 429 and honours the retry count ceiling', async () => {
    const sleeps: number[] = []
    const { provider, fetcher } = providerWith([
      jsonResponse({ error: { code: 10007 } }, 429, { 'retry-after': '2' }),
      jsonResponse({ error: { code: 10007 } }, 429, { 'retry-after': '2' }),
      ok()
    ], { sleep: async (ms) => { sleeps.push(ms) } })
    const output = await provider.generate(input)
    expect(output.attempts).toBe(3)
    // Retry-After is honoured, capped by maxDelayMs.
    expect(sleeps).toEqual([5, 5])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('gives up after the attempt ceiling and reports the class', async () => {
    const { provider } = providerWith([
      jsonResponse({}, 500),
      jsonResponse({}, 502),
      jsonResponse({}, 503)
    ])
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'PROVIDER_NETWORK' })
  })

  it('does not retry an authentication failure', async () => {
    const { provider, fetcher } = providerWith([jsonResponse({ error: { code: 10013 } }, 401)])
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'PROVIDER_AUTH' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retry "no order/quota"', async () => {
    const { provider, fetcher } = providerWith([jsonResponse({ error: { code: 11200 } }, 403)])
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'PROVIDER_QUOTA' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retry a missing model', async () => {
    const { provider, fetcher } = providerWith([jsonResponse({ error: { code: 10404 } }, 400)])
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'PROVIDER_MODEL' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the user cancels during backoff', async () => {
    const controller = new AbortController()
    const secrets = new MemorySecretStore()
    secrets.set('deepseek', 'test-only-secret')
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      return jsonResponse({}, 429)
    })
    const provider = new OpenAICompatibleProvider(config, secrets, fetcher, 45_000, {
      maxAttempts: 3,
      baseDelayMs: 60_000,
      maxDelayMs: 60_000,
      sleep: async () => { await new Promise((resolve) => setTimeout(resolve, 60_000)) }
    })
    const pending = provider.generate({ ...input, signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
    expect(calls).toBe(1)
  })

  it('reports a timeout without retrying forever', async () => {
    const { provider, fetcher } = providerWith([
      jsonResponse({}, 408),
      jsonResponse({}, 408),
      jsonResponse({}, 408)
    ])
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never replays a stream that already produced text', async () => {
    const encoder = new TextEncoder()
    const partial = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'))
        // Let the consumer read the chunk before the socket dies.
        setTimeout(() => controller.error(new Error('socket closed')), 5)
      }
    }), { status: 200 })
    const { provider, fetcher } = providerWith([partial, ok()])
    const deltas: string[] = []
    await expect(provider.generate({ ...input, requestPayload: { ...(input.requestPayload ?? {}), stream: true } }, (delta) => deltas.push(delta))).rejects.toBeTruthy()
    expect(deltas).toEqual(['你'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

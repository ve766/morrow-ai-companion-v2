import type { ProviderConfigRecord } from '../shared/companion'
import { isRemoteConfigValid } from './provider-registry'
import { DEFAULT_PROVIDER_TOTAL_BUDGET_MS } from './provider-policy'
import { ApplicationError, type ApplicationErrorCode } from '../shared/errors'
import { mapProviderSecretError } from '../security/provider-secret-errors'
import { isLoopbackEndpoint, isValidLocalModelName } from '../security/url-gate'
import type { SecretStore } from '../security/secrets'
import type { ProviderDeltaHandler, ProviderInput, ProviderOutput, ProviderPort, ProviderProfile } from './provider-policy'

export interface OpenAIChatPayload {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  stream?: boolean
  max_tokens?: number
  thinking?: { type: 'enabled' | 'disabled' }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Budget for the whole logical request, retries and backoff included. */
  totalBudgetMs?: number
  /** Injected in tests so a backoff does not slow the suite down. */
  sleep?: (ms: number) => Promise<void>
}

/** Only transient failures are retried; auth, quota, model and cancel never are. */
const RETRYABLE_CODES: ReadonlySet<ApplicationErrorCode> = new Set(['PROVIDER_RATE_LIMIT', 'PROVIDER_TIMEOUT', 'PROVIDER_NETWORK'])
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

class RetryableProviderError extends ApplicationError {
  constructor(code: ApplicationErrorCode, readonly retryAfterMs: number | null) {
    super(code)
    this.name = 'RetryableProviderError'
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date; both are capped later. */
function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return null
  return Math.max(0, date - now)
}

type StreamChunk = {
  model?: unknown
  choices?: Array<{ delta?: { content?: unknown } }>
}

function parseStreamChunk(data: string): StreamChunk {
  try {
    return JSON.parse(data) as StreamChunk
  } catch {
    throw new ApplicationError('PROVIDER_RESPONSE')
  }
}

/**
 * Reads a bounded part of an error body and returns the provider's numeric code
 * when it has one. The body itself is discarded: it can contain request data.
 */
async function readProviderErrorCode(response: Response): Promise<number | null> {
  try {
    const text = (await response.text()).slice(0, 4096)
    const parsed = JSON.parse(text) as { code?: unknown; error?: { code?: unknown } } | null
    const raw = parsed?.error && typeof parsed.error === 'object' ? parsed.error.code : parsed?.code
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  } catch {
    return null
  }
}

async function readStream(response: Response, model: string, onDelta?: ProviderDeltaHandler): Promise<ProviderOutput> {
  if (!response.body) throw new ApplicationError('PROVIDER_RESPONSE')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventData: string[] = []
  let text = ''
  let modelId = model
  let streamDone = false

  const dispatchEvent = (): void => {
    if (eventData.length === 0 || streamDone) return
    const data = eventData.join('\n')
    eventData = []
    if (data === '[DONE]') {
      streamDone = true
      return
    }
    const chunk = parseStreamChunk(data)
    if (typeof chunk.model === 'string') modelId = chunk.model
    const delta = chunk.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      text += delta
      if (text.length > 100_000) throw new ApplicationError('PROVIDER_RESPONSE')
      onDelta?.(delta)
    }
  }

  const consumeLine = (line: string): void => {
    if (line.length === 0) {
      dispatchEvent()
      return
    }
    if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /u, ''))
  }

  try {
    while (!streamDone) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 100_000) throw new ApplicationError('PROVIDER_RESPONSE')
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline).replace(/\r$/u, ''))
        buffer = buffer.slice(newline + 1)
        if (streamDone) break
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) consumeLine(buffer.replace(/\r$/u, ''))
    dispatchEvent()
    if (!streamDone || text.trim().length === 0) throw new ApplicationError('PROVIDER_RESPONSE')
    return { text: text.trim(), modelId }
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      return Promise.reject(error)
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}

export class OpenAICompatibleProvider implements ProviderPort {
  readonly profile: ProviderProfile

  constructor(
    private readonly config: ProviderConfigRecord,
    private readonly secrets: SecretStore,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
    private readonly timeoutMs = 45_000,
    private readonly retry: RetryOptions = {}
  ) {
    this.profile = {
      id: config.id,
      providerClass: config.providerClass,
      configured: config.enabled && this.isConfigShapeValid()
    }
  }

  private isConfigShapeValid(): boolean {
    if (this.config.providerClass === 'remote') {
      // Registry-based: the host must be allow-listed and the model id must
      // match the provider's shape, so a second OpenAI-compatible provider can
      // be configured without opening the URL check.
      return this.config.apiKeyConfigured &&
        isRemoteConfigValid(this.config.id, this.config.endpoint, this.config.model)
    }
    return isLoopbackEndpoint(this.config.endpoint) && isValidLocalModelName(this.config.model)
  }

  /** Bounded retry: only transient failures, never auth/quota/model/cancel. */
  private retryDelayMs(attempt: number, retryAfterMs: number | null): number {
    const base = this.retry.baseDelayMs ?? 400
    const cap = this.retry.maxDelayMs ?? 30_000
    const backoff = Math.min(cap, base * 2 ** (attempt - 1))
    return Math.min(cap, retryAfterMs ?? backoff)
  }

  private async delayBeforeRetry(attempt: number, retryAfterMs: number | null, signal?: AbortSignal, remainingMs?: number): Promise<void> {
    const waitMs = Math.max(1, Math.min(this.retryDelayMs(attempt, retryAfterMs), remainingMs ?? Number.MAX_SAFE_INTEGER))
    if (signal?.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
    const sleep = this.retry.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    if (!signal) {
      await sleep(waitMs)
      return
    }
    // Wake up immediately when the caller cancels mid-backoff.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    if (signal.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
  }

  async generate(input: ProviderInput, onDelta?: ProviderDeltaHandler): Promise<ProviderOutput> {
    const maxAttempts = Math.max(1, this.retry.maxAttempts ?? 3)
    const budget = Math.max(1, this.retry.totalBudgetMs ?? DEFAULT_PROVIDER_TOTAL_BUDGET_MS)
    const deadline = Date.now() + budget
    const remaining = (): number => deadline - Date.now()
    let attempt = 0
    for (;;) {
      if (remaining() <= 0) throw new ApplicationError('PROVIDER_DEADLINE')
      attempt += 1
      let emitted = false
      try {
        const output = await this.generateOnce(input, (delta) => {
          emitted = true
          onDelta?.(delta)
        }, remaining())
        return { ...output, attempts: attempt }
      } catch (error) {
        if (error instanceof ApplicationError && error.code === 'PROVIDER_DEADLINE') throw error
        const failure = error instanceof ApplicationError ? error : new ApplicationError('PROVIDER_NETWORK')
        const retryable = RETRYABLE_CODES.has(failure.code) && !emitted && attempt < maxAttempts
        if (!retryable) throw failure
        // A stream that already produced text must not be replayed.
        const retryAfter = failure instanceof RetryableProviderError ? failure.retryAfterMs : null
        // A backoff that cannot finish inside the budget is a deadline, not a
        // retry: fail now instead of sleeping past the ceiling.
        if (this.retryDelayMs(attempt, retryAfter) >= remaining()) throw new ApplicationError('PROVIDER_DEADLINE')
        await this.delayBeforeRetry(attempt, retryAfter, input.signal, remaining())
      }
    }
  }

  /** One HTTP attempt. Throws a classified ApplicationError on failure. */
  private async generateOnce(input: ProviderInput, onDelta?: ProviderDeltaHandler, budgetMs?: number): Promise<ProviderOutput> {
    const payload = input.requestPayload as OpenAIChatPayload
    if (
      !this.isConfigShapeValid() ||
      input.endpoint !== `${this.config.endpoint}/chat/completions` ||
      (this.config.providerClass === 'local' && !isLoopbackEndpoint(input.endpoint)) ||
      !payload ||
      payload.model !== this.config.model ||
      !Array.isArray(payload.messages) ||
      payload.messages.length === 0
    ) throw new ApplicationError('INVALID_INPUT')

    const controller = new AbortController()
    let timedOut = false
    const cancelFromCaller = (): void => controller.abort()
    if (input.signal?.aborted) cancelFromCaller()
    else input.signal?.addEventListener('abort', cancelFromCaller, { once: true })
    // A single attempt may never outlive the request budget.
    const attemptTimeout = Math.max(1, Math.min(this.timeoutMs, budgetMs ?? this.timeoutMs))
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, attemptTimeout)

    try {
      let key: string | undefined
      try {
        key = this.secrets.get(this.config.id)
      } catch (error) {
        throw mapProviderSecretError(error)
      }
      if (!key && this.config.providerClass === 'remote') throw new ApplicationError('PROVIDER_UNCONFIGURED')
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (key) headers.authorization = `Bearer ${key}`
      const response = await this.fetcher(input.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error'
      })
      if (!response.ok) {
        // The body carries a provider error code; it separates "bad key" from
        // "no order/quota" and "no such model". Only the code is read, never
        // the whole body, and it is never echoed back to the caller.
        const providerCode = await readProviderErrorCode(response)
        if (response.status === 400 && providerCode === 10404) throw new ApplicationError('PROVIDER_MODEL')
        if (response.status === 403 && providerCode === 11200) throw new ApplicationError('PROVIDER_QUOTA')
        if (response.status === 401 || response.status === 403) throw new ApplicationError('PROVIDER_AUTH')
        if (response.status === 404) throw new ApplicationError('PROVIDER_MODEL')
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        if (response.status === 408 || response.status === 504) throw new RetryableProviderError('PROVIDER_TIMEOUT', retryAfter)
        if (response.status === 429) throw new RetryableProviderError('PROVIDER_RATE_LIMIT', retryAfter)
        if (RETRYABLE_STATUS.has(response.status)) throw new RetryableProviderError('PROVIDER_NETWORK', retryAfter)
        throw new ApplicationError('PROVIDER_NETWORK')
      }
      if (payload.stream) {
        const output = await readStream(response, this.config.model, onDelta)
        if (input.signal?.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
        return output
      }
      let data: { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown }
      try {
        data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown }
      } catch {
        throw new ApplicationError('PROVIDER_RESPONSE')
      }
      const text = data.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > 100_000) throw new ApplicationError('PROVIDER_RESPONSE')
      // A response that arrived after the attempt was aborted must not be used.
      if (controller.signal.aborted) throw new ApplicationError(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_CANCELLED')
      if (input.signal?.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
      return { text: text.trim(), modelId: typeof data.model === 'string' ? data.model : this.config.model }
    } catch (error) {
      if (error instanceof ApplicationError) throw error
      if (input.signal?.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
      if (timedOut) throw new ApplicationError('PROVIDER_TIMEOUT')
      throw new ApplicationError('PROVIDER_NETWORK')
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', cancelFromCaller)
    }
  }
}

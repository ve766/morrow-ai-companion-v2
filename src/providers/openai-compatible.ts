import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, THIRD_PARTY_PROVIDER_ID, type ProviderConfigRecord } from '../shared/companion'
import { ApplicationError } from '../shared/errors'
import { mapProviderSecretError } from '../security/provider-secret-errors'
import { isHttpsEndpoint, isLoopbackEndpoint, isValidLocalModelName, isValidRemoteModelId, normalizeOpenAIBaseUrl } from '../security/url-gate'
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
    private readonly timeoutMs = 45_000
  ) {
    this.profile = {
      id: config.id,
      providerClass: config.providerClass,
      configured: config.enabled && this.isConfigShapeValid()
    }
  }

  /**
   * The remote shape used to be "is exactly DeepSeek". A user-configured
   * gateway is the second remote shape, and it is checked just as strictly:
   * https only, a key present, and the model id it was configured with. The
   * DeepSeek branch is unchanged, so the default provider cannot drift.
   */
  private isConfigShapeValid(): boolean {
    if (this.config.providerClass === 'remote') {
      if (this.config.id === THIRD_PARTY_PROVIDER_ID) {
        return this.config.apiKeyConfigured &&
          isHttpsEndpoint(this.config.endpoint) &&
          isValidRemoteModelId(this.config.model)
      }
      return this.config.apiKeyConfigured &&
        this.config.endpoint === DEEPSEEK_API_BASE_URL &&
        this.config.model === DEEPSEEK_MODEL
    }
    return isLoopbackEndpoint(this.config.endpoint) && isValidLocalModelName(this.config.model)
  }

  /** `{base}/chat/completions`, with the base normalised once, here. */
  private get chatEndpoint(): string {
    return `${normalizeOpenAIBaseUrl(this.config.endpoint)}/chat/completions`
  }

  private get effectiveTimeoutMs(): number {
    return this.config.id === THIRD_PARTY_PROVIDER_ID
      ? (this.config.timeoutMs ?? this.timeoutMs)
      : this.timeoutMs
  }

  /**
   * `GET {base}/models`. Used to decide whether a model id is catalogue
   * verified; a 200 here is evidence about the catalogue only, never about
   * chat quality. The key is sent in a header and never logged.
   */
  async listModels(signal?: AbortSignal): Promise<{ ids: string[] }> {
    if (this.config.providerClass !== 'remote' || !this.config.apiKeyConfigured) throw new ApplicationError('PROVIDER_UNCONFIGURED')
    const controller = new AbortController()
    const cancel = (): void => controller.abort()
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.min(this.effectiveTimeoutMs, 20_000))
    try {
      let key: string | undefined
      try {
        key = this.secrets.get(this.config.id)
      } catch (error) {
        throw mapProviderSecretError(error)
      }
      if (!key) throw new ApplicationError('PROVIDER_UNCONFIGURED')
      const response = await this.fetcher(`${normalizeOpenAIBaseUrl(this.config.endpoint)}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${key}` },
        signal: controller.signal,
        redirect: 'error'
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new ApplicationError('PROVIDER_AUTH')
        if (response.status === 429) throw new ApplicationError('PROVIDER_RATE_LIMIT')
        if (response.status === 404) throw new ApplicationError('PROVIDER_MODEL')
        throw new ApplicationError('PROVIDER_NETWORK')
      }
      let data: { data?: Array<{ id?: unknown }> }
      try {
        data = await response.json() as { data?: Array<{ id?: unknown }> }
      } catch {
        throw new ApplicationError('PROVIDER_RESPONSE')
      }
      if (!Array.isArray(data.data)) throw new ApplicationError('PROVIDER_RESPONSE')
      const ids = data.data.map((entry) => entry?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
      return { ids }
    } catch (error) {
      if (error instanceof ApplicationError) throw error
      if (signal?.aborted) throw new ApplicationError('PROVIDER_CANCELLED')
      if (controller.signal.aborted) throw new ApplicationError('PROVIDER_TIMEOUT')
      throw new ApplicationError('PROVIDER_NETWORK')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    }
  }

  async generate(input: ProviderInput, onDelta?: ProviderDeltaHandler): Promise<ProviderOutput> {
    const payload = input.requestPayload as OpenAIChatPayload
    if (
      !this.isConfigShapeValid() ||
      input.endpoint !== this.chatEndpoint ||
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
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.effectiveTimeoutMs)

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
        if (response.status === 401 || response.status === 403) throw new ApplicationError('PROVIDER_AUTH')
        if (response.status === 429) throw new ApplicationError('PROVIDER_RATE_LIMIT')
        if (response.status === 404) throw new ApplicationError('PROVIDER_MODEL')
        if (response.status === 408 || response.status === 504) throw new ApplicationError('PROVIDER_TIMEOUT')
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

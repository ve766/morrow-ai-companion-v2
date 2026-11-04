/**
 * Endpoint resolution for provider profiles.
 *
 * The old product built `${endpoint}/chat/completions` and required the
 * endpoint to be exactly a provider base URL. A user may paste a base
 * (`https://relay.example.com`), a versioned base
 * (`https://relay.example.com/v1`) or the full chat URL. All three must resolve
 * to one request URL without duplicate `/v1` or `/chat/completions` segments.
 */
const CHAT_SUFFIX = '/chat/completions'
const MODELS_SUFFIX = '/models'

export class EndpointShapeError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'EndpointShapeError'
  }
}

export function normalizeBaseUrl(input: string): string {
  if (typeof input !== 'string' || input.length < 8 || input.length > 2000) throw new EndpointShapeError('invalid_length')
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new EndpointShapeError('invalid_url')
  }
  if (url.username !== '' || url.password !== '') throw new EndpointShapeError('userinfo_not_allowed')
  if (url.hash !== '') throw new EndpointShapeError('fragment_not_allowed')
  if (url.search !== '') throw new EndpointShapeError('query_not_allowed')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EndpointShapeError('scheme_not_allowed')
  const path = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${path}`
}

export function validateEndpointPath(path: string | null | undefined): string | null {
  if (path === null || path === undefined || path === '') return null
  if (typeof path !== 'string' || path.length > 300) throw new EndpointShapeError('invalid_path')
  if (!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#')) {
    throw new EndpointShapeError('invalid_path')
  }
  return path.replace(/\/+$/u, '')
}

function join(base: string, suffix: string): string {
  return `${base.replace(/\/+$/u, '')}${suffix}`
}

/** Resolve the chat operation URL for a profile. */
export function resolveChatEndpoint(baseUrl: string, endpointPath?: string | null): string {
  const base = normalizeBaseUrl(baseUrl)
  if (base.endsWith(CHAT_SUFFIX)) return base
  const custom = validateEndpointPath(endpointPath)
  if (custom) {
    if (custom.endsWith(CHAT_SUFFIX)) {
      const basePath = new URL(base).pathname.replace(/\/+$/u, '')
      const prefix = custom.slice(0, -CHAT_SUFFIX.length)
      if (prefix && basePath.endsWith(prefix)) return join(base, custom.slice(prefix.length))
      return join(base, custom)
    }
    if (custom.endsWith('/v1') && new URL(base).pathname.endsWith('/v1')) {
      return join(base, CHAT_SUFFIX)
    }
    return join(base, custom)
  }
  return join(base, CHAT_SUFFIX)
}

/** Resolve the optional model-discovery URL. */
export function resolveModelsEndpoint(baseUrl: string, endpointPath?: string | null): string {
  const base = normalizeBaseUrl(baseUrl)
  if (base.endsWith(CHAT_SUFFIX)) return join(base.slice(0, -CHAT_SUFFIX.length), MODELS_SUFFIX)
  if (base.endsWith(MODELS_SUFFIX)) return base
  const custom = validateEndpointPath(endpointPath)
  if (custom) {
    if (custom.endsWith(CHAT_SUFFIX)) {
      const prefix = custom.slice(0, -CHAT_SUFFIX.length)
      const basePath = new URL(base).pathname.replace(/\/+$/u, '')
      if (prefix && basePath.endsWith(prefix)) {
        return join(base, `${custom.slice(prefix.length, -CHAT_SUFFIX.length)}${MODELS_SUFFIX}`)
      }
      return join(base, `${prefix}${MODELS_SUFFIX}`)
    }
    if (custom.endsWith('/v1') && !new URL(base).pathname.endsWith('/v1')) return join(base, `${custom}${MODELS_SUFFIX}`)
  }
  return join(base, MODELS_SUFFIX)
}

// A local-class provider may only ever target a literal loopback endpoint.
// Anything that cannot be *proven* local from the URL text itself — DNS names,
// shared/link-local or unspecified addresses, IPv4-mapped forms, embedded
// credentials, or unparseable input — fails closed. Hostname resolution is
// deliberately not performed or trusted: the endpoint string must prove it.
export function isLoopbackEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2000) return false
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost') return true
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    // WHATWG URLs keep the brackets around IPv6 literals in hostname.
    return hostname.slice(1, -1) === '::1'
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname)
  if (ipv4) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map((value) => Number(value))
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
    return octets[0] === 127
  }
  return false
}

export function isValidLocalModelName(model: string): boolean {
  if (typeof model !== 'string') return false
  const trimmed = model.trim()
  return trimmed.length >= 1 && trimmed.length <= 64 && trimmed === model &&
    !/[\u0000-\u001f\u007f]/u.test(trimmed)
}

/**
 * A remote OpenAI-compatible base URL.
 *
 * Only `https:` is accepted: a remote provider carries credentials and private
 * conversation text, and plain HTTP would expose both on the wire. Embedded
 * credentials are refused because the API key travels in a header, not in the
 * URL, and a URL-embedded password would end up in logs.
 */
export function isHttpsEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length < 8 || endpoint.length > 2000) return false
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.hostname.length === 0) return false
  // A query or fragment on a base URL is always a configuration mistake.
  if (parsed.search !== '' || parsed.hash !== '') return false
  return true
}

/**
 * Canonical base URL for an OpenAI-compatible service.
 *
 * The chat endpoint is always derived as `${base}/chat/completions`, so a user
 * who pastes the full chat URL, or a trailing `/v1/`, must not produce
 * `/v1/v1/chat/completions` or `/chat/completions/chat/completions`. Only the
 * documented suffixes are stripped; anything else is left alone and rejected
 * later by the shape check.
 */
export function normalizeOpenAIBaseUrl(endpoint: string): string {
  let value = endpoint.trim().replace(/\/+$/u, '')
  if (/\/chat\/completions$/iu.test(value)) value = value.replace(/\/chat\/completions$/iu, '')
  return value.replace(/\/+$/u, '')
}

/**
 * Model ids on a remote catalogue are opaque strings, not filesystem names:
 * the probe of the candidate gateways returned ids such as "入梦 Flash" with a
 * space in them, so spaces must be allowed. Only control characters, leading or
 * trailing whitespace and absurd lengths are refused.
 */
export function isValidRemoteModelId(model: string): boolean {
  if (typeof model !== 'string') return false
  if (model.length < 1 || model.length > 200) return false
  if (model !== model.trim()) return false
  if (/[\u0000-\u001f\u007f]/u.test(model)) return false
  return true
}

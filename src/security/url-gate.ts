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

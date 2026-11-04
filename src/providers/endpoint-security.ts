/**
 * Endpoint safety for user-supplied providers.
 *
 * The remote path is HTTPS-only and, for custom relays, the host is resolved
 * before the request and rejected when any address is loopback, link-local,
 * private, unique-local, multicast, unspecified or a well-known metadata host.
 * Redirects are refused by the adapter (`redirect: 'error'`), so a public
 * endpoint cannot bounce the request into a private network after this check.
 * DNS rebinding between lookup and connect remains a residual risk documented in
 * the architecture report; the adapter does not follow redirects and re-checks
 * every attempt.
 */
import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { isLoopbackEndpoint } from '../security/url-gate'
import { normalizeBaseUrl } from './endpoint-resolver'

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain'])
const METADATA_NAMES = new Set([
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
  'metadata',
  'metadata.azure.internal'
])

export class EndpointSecurityError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'EndpointSecurityError'
  }
}

function ipv4Private(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  return a === 0 ||
    a === 10 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
}

function parseIpv6(address: string): number[] | null {
  let value = address.toLowerCase()
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  const parseParts = (parts: string[]): number[] | null => {
    const output: number[] = []
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!
      if (part.includes('.')) {
        if (index !== parts.length - 1) return null
        const octets = part.split('.').map(Number)
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
        output.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!)
      } else {
        if (!/^[0-9a-f]{1,4}$/u.test(part)) return null
        output.push(Number.parseInt(part, 16))
      }
    }
    return output
  }
  const pieces = value.split('::')
  if (pieces.length > 2) return null
  const head = pieces[0] ? parseParts(pieces[0].split(':')) : []
  if (head === null) return null
  if (pieces.length === 1) return head.length === 8 ? head : null
  const tail = pieces[1] ? parseParts(pieces[1].split(':')) : []
  if (tail === null) return null
  if (head.length + tail.length > 8) return null
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
}

function embeddedIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

function ipv6Private(address: string): boolean {
  const hextets = parseIpv6(address)
  if (!hextets) return true
  const zeroPrefix = (count: number): boolean => hextets.slice(0, count).every((value) => value === 0)
  if (hextets.every((value) => value === 0)) return true
  if (zeroPrefix(7) && hextets[7] === 1) return true
  if ((hextets[0]! & 0xffc0) === 0xfe80) return true
  if ((hextets[0]! & 0xfe00) === 0xfc00) return true
  if ((hextets[0]! & 0xff00) === 0xff00) return true
  // IPv4-mapped (::ffff:a.b.c.d and ::ffff:xxxx:xxxx), IPv4-compatible,
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) all carry an embedded IPv4.
  if (zeroPrefix(5) && hextets[5] === 0xffff) return ipv4Private(embeddedIpv4(hextets[6]!, hextets[7]!))
  if (zeroPrefix(6)) return ipv4Private(embeddedIpv4(hextets[6]!, hextets[7]!))
  if (hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets.slice(2, 6).every((value) => value === 0)) {
    return ipv4Private(embeddedIpv4(hextets[6]!, hextets[7]!))
  }
  if (hextets[0] === 0x2002) return ipv4Private(embeddedIpv4(hextets[1]!, hextets[2]!))
  return false
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return ipv4Private(address)
  if (family === 6) return ipv6Private(address)
  return true
}

export interface EndpointClassification {
  url: URL
  host: string
  isIp: boolean
  local: boolean
}

/** Synchronous shape check; DNS is checked by `assertPublicEndpoint`. */
export function classifyEndpoint(endpoint: string, sourceKind: 'official' | 'custom-proxy' | 'local' | 'private-network'): EndpointClassification {
  if (sourceKind === 'private-network') throw new EndpointSecurityError('private_network_not_supported')
  const normalized = normalizeBaseUrl(endpoint)
  const url = new URL(normalized)
  const rawHost = url.hostname.toLowerCase()
  // WHATWG keeps brackets around IPv6 literals; a trailing dot on a DNS name
  // is the same host and must not bypass the name checks below.
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost.replace(/\.+$/u, '')
  const isIp = isIP(host) !== 0
  if (sourceKind === 'local') {
    if (!isLoopbackEndpoint(normalized)) throw new EndpointSecurityError('local_must_be_loopback')
    return { url, host, isIp, local: true }
  }
  if (url.protocol !== 'https:') throw new EndpointSecurityError('remote_must_be_https')
  if (LOOPBACK_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new EndpointSecurityError('remote_host_not_public')
  }
  if (METADATA_NAMES.has(host)) throw new EndpointSecurityError('metadata_host')
  if (isIp && isPrivateAddress(host)) throw new EndpointSecurityError('private_address')
  return { url, host, isIp, local: false }
}

export interface EndpointPolicy {
  assertAllowed(endpoint: string, sourceKind: 'official' | 'custom-proxy' | 'local' | 'private-network'): Promise<void>
}

export type Lookup = (host: string) => Promise<Array<{ address: string }>>

export function createEndpointPolicy(lookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true })): EndpointPolicy {
  return {
    async assertAllowed(endpoint, sourceKind) {
      const classified = classifyEndpoint(endpoint, sourceKind)
      if (classified.local || classified.isIp) return
      let addresses: Array<{ address: string }>
      try {
        addresses = await lookup(classified.host)
      } catch {
        throw new EndpointSecurityError('dns_lookup_failed')
      }
      if (addresses.length === 0) throw new EndpointSecurityError('dns_no_address')
      for (const entry of addresses) {
        if (isPrivateAddress(entry.address)) throw new EndpointSecurityError('private_address')
      }
    }
  }
}

export const defaultEndpointPolicy: EndpointPolicy = createEndpointPolicy()

/** A stable, non-reversible identifier of the endpoint for health records. */
export function endpointDigest(endpoint: string): string {
  try {
    return createHash('sha256').update(normalizeBaseUrl(endpoint)).digest('hex').slice(0, 16)
  } catch {
    return 'invalid-endpoint'
  }
}

/** Display form: origin and path, never query/fragment/userinfo. */
export function maskEndpoint(endpoint: string): string {
  try {
    const url = new URL(normalizeBaseUrl(endpoint))
    return `${url.origin}${url.pathname}`
  } catch {
    return 'invalid-endpoint'
  }
}

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
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
}

function ipv6Private(address: string): boolean {
  const value = address.toLowerCase()
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.startsWith('ff')) return true
  // IPv4-mapped addresses (::ffff:127.0.0.1 etc.) are judged by the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(value)
  if (mapped) return ipv4Private(mapped[1]!)
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
  const host = url.hostname.toLowerCase()
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

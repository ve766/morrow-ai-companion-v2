import { createHash, timingSafeEqual } from 'node:crypto'
import type { AssembledMemoryContext, Sensitivity } from '../shared/companion'
import { ApplicationError } from '../shared/errors'

export type ProviderClass = 'mock' | 'local' | 'remote'
export type ProviderAction = 'chat' | 'connection-test' | 'memory-proposal'

export interface ProviderProfile {
  id: string
  providerClass: ProviderClass
  configured: boolean
}

export interface ProviderInput {
  prompt: string
  context: AssembledMemoryContext
  requestPayload: unknown
  endpoint: string
  maximumSensitivity: Sensitivity
  signal?: AbortSignal
}

export type ProviderDeltaHandler = (delta: string) => void

export interface ProviderOutput {
  text: string
  modelId: string
}

export interface ProviderPort {
  profile: ProviderProfile
  generate(input: ProviderInput, onDelta?: ProviderDeltaHandler): Promise<ProviderOutput>
}

export interface ProviderConsent {
  providerId: string
  payloadSha256: string
  approvedAt: string
  expiresAt: string
  includeSensitive: boolean
}

export interface ProviderConsentPreview {
  action: ProviderAction
  providerId: string
  endpoint: string
  model: string
  payloadSha256: string
  payloadBytes: number
  maximumSensitivity: Sensitivity
  includedMemories: Array<{ id: string; excerpt: string; sensitivity: Sensitivity }>
  exactPayload: string
}

export type ProviderDecision =
  | { allowed: true; payloadSha256: string; maximumSensitivity: Sensitivity }
  | { allowed: false; reason: 'unconfigured' | 'payload_too_large' | 'consent_required' | 'invalid_consent' | 'sensitive_context_not_approved' | 'endpoint_not_local' }

export const MAX_PROVIDER_PAYLOAD_BYTES = 64_000
const maximumConsentLifetimeMs = 5 * 60_000
const sensitivityOrder: readonly Sensitivity[] = ['normal', 'personal', 'sensitive']

// Re-exported for compatibility: the loopback gate is security-critical and
// lives in src/security so shared validation can apply it without a
// shared → providers dependency.
import { isLoopbackEndpoint } from '../security/url-gate'
export { isLoopbackEndpoint } from '../security/url-gate'

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

export function hashProviderInput(input: ProviderInput): string {
  const payload = stableJson({ endpoint: input.endpoint, body: input.requestPayload })
  return createHash('sha256').update(payload).digest('hex')
}

export function assessProviderRequest(
  provider: ProviderProfile,
  input: ProviderInput,
  consent?: ProviderConsent,
  now = new Date().toISOString()
): ProviderDecision {
  if (!provider.configured || provider.id.trim().length === 0) return { allowed: false, reason: 'unconfigured' }
  const payload = stableJson({ endpoint: input.endpoint, body: input.requestPayload })
  if (Buffer.byteLength(payload, 'utf8') > MAX_PROVIDER_PAYLOAD_BYTES) return { allowed: false, reason: 'payload_too_large' }
  const payloadSha256 = createHash('sha256').update(payload).digest('hex')
  const maximumSensitivity = input.context.selected.reduce<Sensitivity>((current, item) => {
    return sensitivityOrder.indexOf(item.sensitivity) > sensitivityOrder.indexOf(current) ? item.sensitivity : current
  }, input.maximumSensitivity)
  if (provider.providerClass === 'local' && !isLoopbackEndpoint(input.endpoint)) {
    return { allowed: false, reason: 'endpoint_not_local' }
  }
  if (!consent) return { allowed: false, reason: 'consent_required' }
  const nowMs = Date.parse(now)
  const approvedAtMs = Date.parse(consent.approvedAt)
  const expiresAtMs = Date.parse(consent.expiresAt)
  const validConsent =
    consent.providerId === provider.id &&
    matchesPayloadHash(consent.payloadSha256, payloadSha256) &&
    Number.isFinite(nowMs) &&
    Number.isFinite(approvedAtMs) &&
    Number.isFinite(expiresAtMs) &&
    approvedAtMs <= nowMs &&
    expiresAtMs > nowMs &&
    expiresAtMs - approvedAtMs <= maximumConsentLifetimeMs
  if (!validConsent) return { allowed: false, reason: 'invalid_consent' }
  if (maximumSensitivity === 'sensitive' && !consent.includeSensitive) {
    return { allowed: false, reason: 'sensitive_context_not_approved' }
  }
  return { allowed: true, payloadSha256, maximumSensitivity }
}

export async function dispatchToProvider(
  provider: ProviderPort,
  input: ProviderInput,
  consent?: ProviderConsent,
  now?: string,
  onDelta?: ProviderDeltaHandler
): Promise<ProviderOutput> {
  const decision = assessProviderRequest(provider.profile, input, consent, now)
  if (!decision.allowed) {
    if (decision.reason === 'unconfigured') throw new ApplicationError('PROVIDER_UNCONFIGURED')
    if (decision.reason === 'payload_too_large') throw new ApplicationError('PROVIDER_PAYLOAD_TOO_LARGE')
    if (decision.reason === 'sensitive_context_not_approved') throw new ApplicationError('FORBIDDEN')
    throw new ApplicationError('FORBIDDEN')
  }
  return provider.generate(input, onDelta)
}

export function matchesPayloadHash(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(actual) || !/^[a-f0-9]{64}$/u.test(expected)) return false
  const left = Buffer.from(actual, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function consentPreview(
  action: ProviderAction,
  provider: { id: string; endpoint: string; model: string },
  input: ProviderInput
): ProviderConsentPreview {
  const exactPayload = stableJson({ endpoint: input.endpoint, body: input.requestPayload })
  return {
    action,
    providerId: provider.id,
    endpoint: input.endpoint,
    model: provider.model,
    payloadSha256: createHash('sha256').update(exactPayload).digest('hex'),
    payloadBytes: Buffer.byteLength(exactPayload, 'utf8'),
    maximumSensitivity: input.context.selected.reduce<Sensitivity>((current, item) => {
      return sensitivityOrder.indexOf(item.sensitivity) > sensitivityOrder.indexOf(current) ? item.sensitivity : current
    }, input.maximumSensitivity),
    includedMemories: input.context.selected.map((memory) => ({
      id: memory.id,
      excerpt: memory.content,
      sensitivity: memory.sensitivity
    })),
    exactPayload
  }
}

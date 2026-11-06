/**
 * Provider registry (multi-source, Phase 2.5).
 *
 * The registry no longer decides which endpoints exist. It describes the
 * built-in official providers, normalises a profile and validates its shape.
 * A user profile is a source + protocol + endpoint + model; an id is only an
 * opaque profile key. The actual request URL is resolved by endpoint-resolver
 * and the host is checked by endpoint-security at request time.
 */
import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_PROVIDER_ID,
  LOCAL_PROVIDER_ID,
  SPARK_MAAS_BASE_URL,
  SPARK_PROVIDER_ID,
  type ProviderCapabilities,
  type ProviderConfigRecord,
  type ProviderProtocolId,
  type ProviderSourceKind
} from '../shared/companion'
import { classifyEndpoint } from './endpoint-security'
import { validateEndpointPath } from './endpoint-resolver'
import { isLoopbackEndpoint } from '../security/url-gate'

export interface RemoteProviderSpec {
  id: typeof DEEPSEEK_PROVIDER_ID | typeof SPARK_PROVIDER_ID
  label: string
  baseUrl: string
  sourceKind: 'official'
  protocolId: 'openai-chat-completions'
  /** Model ids are accepted only in this shape; the actual id comes from the account. */
  modelPattern: RegExp
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
// The profile id is also the OS secret-store key, whose limit is 40 bytes.
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u

export const REMOTE_PROVIDER_SPECS: Readonly<Record<RemoteProviderSpec['id'], RemoteProviderSpec>> = Object.freeze({
  [DEEPSEEK_PROVIDER_ID]: {
    id: DEEPSEEK_PROVIDER_ID,
    label: 'DeepSeek',
    baseUrl: DEEPSEEK_API_BASE_URL,
    sourceKind: 'official',
    protocolId: 'openai-chat-completions',
    modelPattern: new RegExp(`^${DEEPSEEK_MODEL}$`, 'u')
  },
  [SPARK_PROVIDER_ID]: {
    id: SPARK_PROVIDER_ID,
    label: 'iFlytek Spark MaaS',
    baseUrl: SPARK_MAAS_BASE_URL,
    sourceKind: 'official',
    protocolId: 'openai-chat-completions',
    modelPattern: MODEL_ID
  }
})

export function remoteSpecFor(providerId: string): RemoteProviderSpec | null {
  return (REMOTE_PROVIDER_SPECS as Record<string, RemoteProviderSpec | undefined>)[providerId] ?? null
}

export function isBuiltinProviderId(providerId: string): boolean {
  return providerId === DEEPSEEK_PROVIDER_ID || providerId === SPARK_PROVIDER_ID || providerId === LOCAL_PROVIDER_ID
}

export function isProfileId(value: string): boolean {
  return PROFILE_ID.test(value)
}

export function isModelId(value: string): boolean {
  return MODEL_ID.test(value)
}

/** A remote config is usable only when the host and the model shape both match. */
export function isRemoteConfigValid(providerId: string, endpoint: string, model: string): boolean {
  const spec = remoteSpecFor(providerId)
  return Boolean(spec && endpoint === spec.baseUrl && spec.modelPattern.test(model))
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = Object.freeze({
  streaming: { declared: true, probed: false, verified: false },
  vision: { declared: false, probed: false, verified: false },
  toolCalling: { declared: false, probed: false, verified: false },
  jsonMode: { declared: false, probed: false, verified: false },
  systemRole: { declared: true, probed: false, verified: false }
})

/** Fill optional fields so a legacy config and a stored profile share one shape. */
export function normalizeProviderConfig(config: ProviderConfigRecord): Required<Pick<ProviderConfigRecord,
  'displayName' | 'sourceKind' | 'protocolId' | 'endpointPath' | 'isDefault' | 'capabilities' | 'lastTest'>> & ProviderConfigRecord {
  const builtin = remoteSpecFor(config.id)
  const sourceKind: ProviderSourceKind = config.sourceKind
    ?? (config.id === LOCAL_PROVIDER_ID ? 'local' : 'official')
  return {
    ...config,
    displayName: config.displayName?.trim() || builtin?.label || config.id,
    sourceKind,
    protocolId: config.protocolId ?? 'openai-chat-completions',
    endpointPath: config.endpointPath ?? null,
    isDefault: config.isDefault ?? false,
    capabilities: config.capabilities ?? { ...DEFAULT_CAPABILITIES },
    lastTest: config.lastTest ?? null
  }
}

export function providerClassFor(sourceKind: ProviderSourceKind): 'remote' | 'local' {
  return sourceKind === 'local' ? 'local' : 'remote'
}

export interface ConfigValidation {
  ok: boolean
  reason?: string
}

export function validateProviderConfig(config: ProviderConfigRecord): ConfigValidation {
  const normalized = normalizeProviderConfig(config)
  if (!PROFILE_ID.test(normalized.id)) return { ok: false, reason: 'invalid_profile_id' }
  if (normalized.displayName.length === 0 || normalized.displayName.length > 80) return { ok: false, reason: 'invalid_display_name' }
  if (normalized.protocolId !== 'openai-chat-completions') return { ok: false, reason: 'protocol_not_supported' }
  if (!MODEL_ID.test(normalized.model)) return { ok: false, reason: 'invalid_model' }
  try {
    validateEndpointPath(normalized.endpointPath)
  } catch {
    return { ok: false, reason: 'invalid_endpoint_path' }
  }
  if (normalized.sourceKind === 'private-network') return { ok: false, reason: 'private_network_not_supported' }
  try {
    if (normalized.sourceKind === 'official') {
      const spec = remoteSpecFor(normalized.id)
      if (!spec) return { ok: false, reason: 'official_profile_unknown' }
      if (normalized.endpoint !== spec.baseUrl) return { ok: false, reason: 'official_endpoint_mismatch' }
      if (!spec.modelPattern.test(normalized.model)) return { ok: false, reason: 'invalid_model' }
      return { ok: true }
    }
    if (normalized.sourceKind === 'local') {
      if (!isLoopbackEndpoint(normalized.endpoint)) return { ok: false, reason: 'local_must_be_loopback' }
      return { ok: true }
    }
    if (normalized.sourceKind === 'custom-proxy') {
      classifyEndpoint(normalized.endpoint, 'custom-proxy')
      return { ok: true }
    }
    return { ok: false, reason: 'unknown_source_kind' }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid_endpoint' }
  }
}

export function isProviderConfigValid(config: ProviderConfigRecord): boolean {
  return validateProviderConfig(config).ok
}

/** Protocols that actually have an adapter in this build. */
export function hasProtocolAdapter(protocolId: ProviderProtocolId): boolean {
  return protocolId === 'openai-chat-completions'
}

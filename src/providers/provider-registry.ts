/**
 * Remote provider registry (Phase 2.3).
 *
 * Remote endpoints used to be validated against the DeepSeek constants, which
 * made a second OpenAI-compatible provider impossible to configure. The
 * registry keeps the security property — only allow-listed hosts, and a model
 * id with a strict character set — without guessing what the account exposes.
 */
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_PROVIDER_ID, SPARK_MAAS_BASE_URL, SPARK_PROVIDER_ID } from '../shared/companion'

export interface RemoteProviderSpec {
  id: typeof DEEPSEEK_PROVIDER_ID | typeof SPARK_PROVIDER_ID
  label: string
  baseUrl: string
  /** Model ids are accepted only in this shape; the actual id comes from the account. */
  modelPattern: RegExp
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u

export const REMOTE_PROVIDER_SPECS: Readonly<Record<RemoteProviderSpec['id'], RemoteProviderSpec>> = Object.freeze({
  [DEEPSEEK_PROVIDER_ID]: {
    id: DEEPSEEK_PROVIDER_ID,
    label: 'DeepSeek',
    baseUrl: DEEPSEEK_API_BASE_URL,
    modelPattern: new RegExp(`^${DEEPSEEK_MODEL}$`, 'u')
  },
  [SPARK_PROVIDER_ID]: {
    id: SPARK_PROVIDER_ID,
    label: 'iFlytek Spark MaaS',
    baseUrl: SPARK_MAAS_BASE_URL,
    modelPattern: MODEL_ID
  }
})

export function remoteSpecFor(providerId: string): RemoteProviderSpec | null {
  return (REMOTE_PROVIDER_SPECS as Record<string, RemoteProviderSpec | undefined>)[providerId] ?? null
}

/** A remote config is usable only when the host and the model shape both match. */
export function isRemoteConfigValid(providerId: string, endpoint: string, model: string): boolean {
  const spec = remoteSpecFor(providerId)
  return Boolean(spec && endpoint === spec.baseUrl && spec.modelPattern.test(model))
}

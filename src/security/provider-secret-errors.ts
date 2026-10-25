import { ApplicationError } from '../shared/errors'
import { SecretStoreError } from './secret-store-error'

export function mapProviderSecretError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error
  if (error instanceof SecretStoreError && (error.code === 'read_failed' || error.code === 'decrypt_failed')) {
    return new ApplicationError('PROVIDER_CREDENTIAL_STORE_ERROR')
  }
  return new ApplicationError('PROVIDER_STORAGE_UNAVAILABLE')
}

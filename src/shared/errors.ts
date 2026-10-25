export type ApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STORAGE_ERROR'
  | 'BACKUP_INVALID'
  | 'PROVIDER_STORAGE_UNAVAILABLE'
  | 'PROVIDER_CREDENTIAL_STORE_ERROR'
  | 'PROVIDER_UNCONFIGURED'
  | 'PROVIDER_PAYLOAD_TOO_LARGE'
  | 'PROVIDER_RESPONSE'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_MODEL'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_CANCELLED'

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode

  constructor(code: ApplicationErrorCode) {
    super(code)
    this.name = 'ApplicationError'
    this.code = code
  }
}

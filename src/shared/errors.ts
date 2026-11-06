export type ApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STORAGE_ERROR'
  | 'BACKUP_INVALID'
  | 'SCHEMA_UPGRADE_REQUIRED'
  | 'PROVIDER_STORAGE_UNAVAILABLE'
  | 'PROVIDER_CREDENTIAL_STORE_ERROR'
  | 'PROVIDER_UNCONFIGURED'
  | 'PROVIDER_PAYLOAD_TOO_LARGE'
  | 'PROVIDER_RESPONSE'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_MODEL'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_DEADLINE'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_ENDPOINT_BLOCKED'
  | 'PROVIDER_CANCELLED'

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode
  /** HTTP status when the failure came from a provider response; null otherwise. */
  readonly httpStatus: number | null

  constructor(code: ApplicationErrorCode, httpStatus: number | null = null) {
    super(code)
    this.name = 'ApplicationError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

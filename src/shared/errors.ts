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
  /**
   * Optional machine-readable detail for a code that covers several causes
   * (e.g. why a correction was refused). It never contains user content.
   */
  readonly detail: string | undefined

  constructor(code: ApplicationErrorCode, detail?: string) {
    super(code)
    this.name = 'ApplicationError'
    this.code = code
    this.detail = detail
  }
}

export type SecretStoreErrorCode = 'unavailable' | 'invalid_identifier' | 'read_failed' | 'decrypt_failed' | 'write_failed' | 'delete_failed'

export class SecretStoreError extends Error {
  constructor(readonly code: SecretStoreErrorCode) {
    super(code === 'unavailable' ? 'OS-backed credential storage is unavailable.' : 'Credential storage operation failed.')
    this.name = 'SecretStoreError'
  }
}

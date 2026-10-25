import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SecretStoreError } from './secret-store-error'

export interface SecretStore {
  isAvailable(): boolean
  set(id: string, value: string): void
  get(id: string): string | undefined
  delete(id: string): void
}

export function hasSecureStorageBackend(
  platform: NodeJS.Platform,
  encryptionAvailable: boolean,
  selectedBackend?: string
): boolean {
  if (!encryptionAvailable) return false
  if (platform !== 'linux') return true
  return selectedBackend !== undefined && selectedBackend !== 'basic_text' && selectedBackend !== 'unknown'
}

function validIdentifier(id: string): boolean {
  return /^[a-z0-9-]{1,40}$/u.test(id)
}

function validCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 10_000 && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export class SafeStorageSecretStore implements SecretStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly removeFile: (path: string) => void = (path) => rmSync(path, { force: true })
  ) {}

  isAvailable(): boolean {
    try {
      const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      return hasSecureStorageBackend(process.platform, safeStorage.isEncryptionAvailable(), backend)
    } catch {
      return false
    }
  }

  set(id: string, value: string): void {
    if (!validIdentifier(id)) throw new SecretStoreError('invalid_identifier')
    if (!validCredential(value)) throw new Error('Credential is invalid.')
    this.get(id)
    if (!this.isAvailable()) throw new SecretStoreError('unavailable')
    const target = this.file(id)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(temporary, safeStorage.encryptString(value), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, target)
    } catch {
      try {
        rmSync(temporary, { force: true })
      } catch {
        throw new SecretStoreError('write_failed')
      }
      throw new SecretStoreError('write_failed')
    }
  }

  get(id: string): string | undefined {
    if (!validIdentifier(id)) throw new SecretStoreError('invalid_identifier')
    if (!this.isAvailable()) throw new SecretStoreError('unavailable')
    let encrypted: Buffer
    try {
      encrypted = readFileSync(this.file(id))
    } catch (error) {
      if (isMissingFile(error)) return undefined
      throw new SecretStoreError('read_failed')
    }
    try {
      const value = safeStorage.decryptString(encrypted)
      if (!validCredential(value)) throw new Error()
      return value
    } catch {
      throw new SecretStoreError('decrypt_failed')
    }
  }

  delete(id: string): void {
    if (!validIdentifier(id)) return
    try {
      this.removeFile(this.file(id))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new SecretStoreError('delete_failed')
    }
  }

  private file(id: string): string {
    return join(this.rootDirectory, 'secrets', `${encodeURIComponent(id)}.bin`)
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  isAvailable(): boolean {
    return true
  }

  set(id: string, value: string): void {
    this.values.set(id, value)
  }

  get(id: string): string | undefined {
    return this.values.get(id)
  }

  delete(id: string): void {
    this.values.delete(id)
  }
}

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secureStorageMock = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret'
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => secureStorageMock.available,
    getSelectedStorageBackend: () => secureStorageMock.backend,
    encryptString: (value: string) => Buffer.from(`mock-cipher:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (value: Buffer) => {
      const encoded = value.toString('utf8')
      if (!encoded.startsWith('mock-cipher:')) throw new Error('Invalid mock ciphertext.')
      return Buffer.from(encoded.slice('mock-cipher:'.length), 'base64').toString('utf8')
    }
  }
}))

import { SafeStorageSecretStore } from './secrets'
import { SecretStoreError } from './secret-store-error'

const directories: string[] = []

beforeEach(() => {
  secureStorageMock.available = true
  secureStorageMock.backend = 'gnome_libsecret'
})

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OS-backed credential file handling', () => {
  it('writes only safeStorage ciphertext and can read and remove the credential', () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-safe-storage-'))
    directories.push(root)
    const store = new SafeStorageSecretStore(root)
    const credential = 'offline-only-synthetic-secret'
    const file = join(root, 'secrets', 'deepseek.bin')

    store.set('deepseek', credential)

    const encrypted = readFileSync(file)
    expect(encrypted.toString('utf8')).not.toContain(credential)
    expect(store.get('deepseek')).toBe(credential)
    store.delete('deepseek')
    expect(() => readFileSync(file)).toThrow()
    expect(store.get('deepseek')).toBeUndefined()
  })

  it('distinguishes a missing credential from unavailable OS-backed storage', () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-safe-storage-'))
    directories.push(root)
    const store = new SafeStorageSecretStore(root)

    expect(store.get('deepseek')).toBeUndefined()
    secureStorageMock.available = false
    expect(() => store.get('deepseek')).toThrowError(new SecretStoreError('unavailable'))
  })

  it('refuses to write credentials when Electron encryption is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-safe-storage-'))
    directories.push(root)
    secureStorageMock.available = false
    const store = new SafeStorageSecretStore(root)

    expect(() => store.set('deepseek', 'offline-only-synthetic-secret'))
      .toThrowError(new SecretStoreError('unavailable'))
    expect(() => readFileSync(join(root, 'secrets', 'deepseek.bin'))).toThrow()
  })

  it('reports corrupt ciphertext and refuses to overwrite or remove it during a failed save', () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-safe-storage-'))
    directories.push(root)
    const store = new SafeStorageSecretStore(root)
    const file = join(root, 'secrets', 'deepseek.bin')
    const corruptCiphertext = Buffer.from('not-a-valid-safe-storage-ciphertext')
    mkdirSync(join(root, 'secrets'), { recursive: true })
    writeFileSync(file, corruptCiphertext)

    let failure: unknown
    try {
      store.get('deepseek')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(SecretStoreError)
    expect(failure).toMatchObject({ code: 'decrypt_failed', message: 'Credential storage operation failed.' })
    expect(String(failure)).not.toContain(root)
    expect(String(failure)).not.toContain(corruptCiphertext.toString('utf8'))
    expect(() => store.set('deepseek', 'replacement-synthetic-secret')).toThrowError(new SecretStoreError('decrypt_failed'))
    expect(readFileSync(file)).toEqual(corruptCiphertext)
  })

  it('distinguishes filesystem read errors from both absence and decryption errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'morrow-safe-storage-'))
    directories.push(root)
    const store = new SafeStorageSecretStore(root)
    const file = join(root, 'secrets', 'deepseek.bin')
    mkdirSync(file, { recursive: true })

    let failure: unknown
    try {
      store.get('deepseek')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(SecretStoreError)
    expect(failure).toMatchObject({ code: 'read_failed', message: 'Credential storage operation failed.' })
    expect(String(failure)).not.toContain(root)
  })
})

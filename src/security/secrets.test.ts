import { describe, expect, it } from 'vitest'
import { hasSecureStorageBackend } from './secrets'

describe('OS-backed credential storage policy', () => {
  it('fails closed when encryption is unavailable', () => {
    expect(hasSecureStorageBackend('win32', false)).toBe(false)
    expect(hasSecureStorageBackend('linux', false, 'gnome_libsecret')).toBe(false)
  })

  it('rejects Linux basic-text and unknown backends', () => {
    expect(hasSecureStorageBackend('linux', true, 'basic_text')).toBe(false)
    expect(hasSecureStorageBackend('linux', true, 'unknown')).toBe(false)
    expect(hasSecureStorageBackend('linux', true)).toBe(false)
  })

  it('allows supported Windows, macOS, and Linux keyring backends', () => {
    expect(hasSecureStorageBackend('win32', true)).toBe(true)
    expect(hasSecureStorageBackend('darwin', true)).toBe(true)
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
      expect(hasSecureStorageBackend('linux', true, backend)).toBe(true)
    }
  })
})

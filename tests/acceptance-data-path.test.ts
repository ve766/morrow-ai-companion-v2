import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { resolveAcceptanceUserData } from '../src/app/acceptance-data-path'

describe('resolveAcceptanceUserData', () => {
  it('returns null when the variable is unset or empty', () => {
    expect(resolveAcceptanceUserData(undefined)).toBeNull()
    expect(resolveAcceptanceUserData('')).toBeNull()
    expect(resolveAcceptanceUserData('   ')).toBeNull()
  })

  it('accepts an absolute path and normalizes it', () => {
    const absolute = resolve('tmp', 'morrow-acceptance')
    expect(resolveAcceptanceUserData(absolute)).toBe(absolute)
  })

  it('rejects a relative path instead of falling back to the default profile', () => {
    expect(() => resolveAcceptanceUserData('relative/profile')).toThrow(/absolute path/)
  })
})

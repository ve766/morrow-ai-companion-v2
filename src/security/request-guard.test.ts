import { describe, expect, it } from 'vitest'
import { createRequestGuard } from './request-guard'

describe('request guard', () => {
  it('lets only the newest request render, ignoring late older responses', () => {
    const guard = createRequestGuard()
    const first = guard.begin()
    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('survives rapid consecutive refreshes and double invocation', () => {
    const guard = createRequestGuard()
    const tokens = [guard.begin(), guard.begin(), guard.begin(), guard.begin()]
    expect(guard.isCurrent(tokens[3]!)).toBe(true)
    expect(tokens.slice(0, 3).every((token) => !guard.isCurrent(token))).toBe(true)
  })

  it('invalidates all outstanding requests so stale handlers cannot clear loading state', () => {
    const guard = createRequestGuard()
    const outstanding = guard.begin()
    guard.invalidate()
    expect(guard.isCurrent(outstanding)).toBe(false)
    const next = guard.begin()
    expect(guard.isCurrent(next)).toBe(true)
  })

  it('reports the current token and keeps tokens unique', () => {
    const guard = createRequestGuard()
    const first = guard.begin()
    expect(guard.current()).toBe(first)
    const second = guard.begin()
    expect(second).not.toBe(first)
    expect(guard.current()).toBe(second)
  })
})

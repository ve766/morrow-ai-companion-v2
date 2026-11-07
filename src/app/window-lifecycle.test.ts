import { describe, expect, it } from 'vitest'
import { IllegalWindowTransition, WindowLifecycle } from './window-lifecycle'

describe('desktop window lifecycle', () => {
  it('follows created -> ready -> visible -> minimized -> visible -> closing -> closed', () => {
    const lifecycle = new WindowLifecycle()
    expect(lifecycle.apply('ready')).toBe('READY')
    expect(lifecycle.apply('show')).toBe('VISIBLE')
    expect(lifecycle.apply('minimize')).toBe('MINIMIZED')
    expect(lifecycle.apply('restore')).toBe('VISIBLE')
    expect(lifecycle.apply('close')).toBe('CLOSING')
    expect(lifecycle.apply('closed')).toBe('CLOSED')
  })

  it('allows a minimized window to be shown by a second launch', () => {
    const lifecycle = new WindowLifecycle()
    lifecycle.apply('ready')
    lifecycle.apply('show')
    lifecycle.apply('minimize')
    expect(lifecycle.apply('show')).toBe('VISIBLE')
  })

  it('rejects illegal transitions instead of silently overwriting state', () => {
    const lifecycle = new WindowLifecycle()
    expect(() => lifecycle.apply('show')).toThrow(IllegalWindowTransition)
    lifecycle.apply('ready')
    lifecycle.apply('show')
    lifecycle.apply('close')
    expect(() => lifecycle.apply('show')).toThrow(IllegalWindowTransition)
  })
})

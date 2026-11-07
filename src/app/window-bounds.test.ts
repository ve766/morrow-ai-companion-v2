import { describe, expect, it } from 'vitest'
import { normalizeWindowBounds } from './window-bounds'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1920, height: 1040 }

describe('window bounds recovery', () => {
  it('centers a default window when no saved bounds exist', () => {
    expect(normalizeWindowBounds(null, [primary], primary)).toEqual({ x: 410, y: 140, width: 1100, height: 760 })
  })

  it('keeps a saved window that is visibly inside a current display', () => {
    expect(normalizeWindowBounds({ x: 200, y: 100, width: 1200, height: 800 }, [primary, second], primary)).toEqual({ x: 200, y: 100, width: 1200, height: 800 })
  })

  it('recovers an off-screen saved position to the primary display', () => {
    const result = normalizeWindowBounds({ x: -4000, y: -3000, width: 1100, height: 760 }, [primary, second], primary)
    expect(result).toEqual({ x: 410, y: 140, width: 1100, height: 760 })
  })

  it('clamps a window larger than the work area and never returns below the minimum', () => {
    const result = normalizeWindowBounds({ x: 0, y: 0, width: 5000, height: 4000 }, [primary], primary)
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1040)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })
})

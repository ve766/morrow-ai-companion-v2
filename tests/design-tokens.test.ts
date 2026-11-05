import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'style.css'), 'utf8')

function token(block: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, 'u').exec(block)
  if (!match?.[1]) throw new Error(`Missing token ${name}`)
  return match[1]
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('design token contrast', () => {
  it('keeps muted body text at WCAG AA 4.5:1 in both themes', () => {
    const root = css.slice(0, css.indexOf('html[data-theme="light"]'))
    const light = css.slice(css.indexOf('html[data-theme="light"]'), css.indexOf('html { scroll-behavior'))
    expect(contrast(token(light, '--muted'), token(light, '--bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(light, '--muted'), token(light, '--panel'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(root, '--muted'), token(root, '--bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(root, '--muted'), token(root, '--panel'))).toBeGreaterThanOrEqual(4.5)
  })
})

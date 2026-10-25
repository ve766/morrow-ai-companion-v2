import { describe, expect, it } from 'vitest'
import { createLogger } from './logger'

describe('structured logger', () => {
  it('emits level-filtered JSON lines with redacted sensitive fields', () => {
    const lines: string[] = []
    const logger = createLogger({ minimumLevel: 'info', sink: (line) => lines.push(line), clock: () => '2026-10-25T10:00:00.000Z' })
    logger.info('providers', 'request prepared', { endpoint: 'https://api.deepseek.com', apiKey: 'sk-secret', requestPayload: { model: 'x' } })
    logger.debug('app', 'hidden below threshold')
    const entry = JSON.parse(lines[0]!) as { level: string; source: string; fields: Record<string, unknown> }
    expect(entry.level).toBe('info')
    expect(entry.source).toBe('providers')
    expect(entry.fields.apiKey).toBe('[redacted]')
    expect(entry.fields.requestPayload).toBe('[redacted]')
    expect(lines).toHaveLength(1)
    expect(JSON.stringify(entry)).not.toContain('sk-secret')
  })

  it('truncates oversized strings and never throws on sink failure', () => {
    const logger = createLogger({ sink: () => { throw new Error('sink down') }, minimumLevel: 'info' })
    expect(() => logger.warn('app', 'x'.repeat(2000), { a: 1 })).not.toThrow()
  })
})

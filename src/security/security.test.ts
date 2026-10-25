import { describe, expect, it } from 'vitest'
import { createSecureWindowOptions, isTrustedRendererUrl, resolveTrustedRendererUrl } from './security'

describe('createSecureWindowOptions', () => {
  it('keeps renderer isolation and disables Node integration', () => {
    const options = createSecureWindowOptions('/tmp/preload.js')
    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    })
  })
})

describe('isTrustedRendererUrl', () => {
  const trustedFile = 'file:///opt/morrow/out/renderer/index.html'

  it('accepts the exact packaged renderer file', () => {
    expect(isTrustedRendererUrl(trustedFile, trustedFile)).toBe(true)
  })

  it('rejects another local file', () => {
    expect(isTrustedRendererUrl('file:///opt/morrow/out/renderer/other.html', trustedFile)).toBe(false)
  })

  it('rejects remote and privileged schemes', () => {
    expect(isTrustedRendererUrl('https://example.com/', trustedFile)).toBe(false)
    expect(isTrustedRendererUrl('javascript:alert(1)', trustedFile)).toBe(false)
    expect(isTrustedRendererUrl('data:text/html,hello', trustedFile)).toBe(false)
  })

  it('accepts only the same loopback dev origin', () => {
    const trustedDev = 'http://localhost:5173/'
    expect(isTrustedRendererUrl('http://localhost:5173/index.html', trustedDev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', trustedDev)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', trustedDev)).toBe(false)
    expect(isTrustedRendererUrl('https://localhost:5173/', trustedDev)).toBe(false)
  })

  it('rejects a non-loopback dev origin', () => {
    const trustedRemote = 'http://example.com:5173/'
    expect(isTrustedRendererUrl('http://example.com:5173/', trustedRemote)).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isTrustedRendererUrl('not a url', trustedFile)).toBe(false)
  })
})

describe('trusted renderer URL resolution', () => {
  const packaged = 'file:///C:/app/out/renderer/index.html'

  it('prefers a non-empty development override', () => {
    expect(resolveTrustedRendererUrl('http://127.0.0.1:5173', packaged)).toBe('http://127.0.0.1:5173')
  })

  it('falls back to the packaged renderer URL for empty, whitespace and missing overrides', () => {
    expect(resolveTrustedRendererUrl(undefined, packaged)).toBe(packaged)
    expect(resolveTrustedRendererUrl('', packaged)).toBe(packaged)
    expect(resolveTrustedRendererUrl('   ', packaged)).toBe(packaged)
  })

  it('never returns an empty trusted URL', () => {
    const resolved = resolveTrustedRendererUrl('', packaged)
    expect(resolved.length).toBeGreaterThan(0)
  })
})

import type { BrowserWindowConstructorOptions } from 'electron'

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function createSecureWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    title: 'Morrow - AI Companion Workbench',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  }
}

// The development override must be honoured only when it is a non-empty,
// non-whitespace URL; an empty or whitespace ELECTRON_RENDERER_URL previously
// resolved to an empty trusted-renderer URL, which silently rejected every
// IPC request in the whole app.
export function resolveTrustedRendererUrl(environmentUrl: string | undefined, packagedRendererUrl: string): string {
  if (typeof environmentUrl === 'string') {
    const candidate = environmentUrl.trim()
    if (candidate.length > 0) return candidate
  }
  return packagedRendererUrl
}

export function isTrustedRendererUrl(actualUrl: string, trustedRendererUrl: string): boolean {
  try {
    const actual = new URL(actualUrl)
    const trusted = new URL(trustedRendererUrl)
    if (trusted.protocol === 'file:') {
      return actual.protocol === 'file:' && actual.href === trusted.href
    }
    return (
      trusted.protocol === 'http:' &&
      loopbackHosts.has(trusted.hostname) &&
      actual.protocol === 'http:' &&
      actual.origin === trusted.origin
    )
  } catch {
    return false
  }
}

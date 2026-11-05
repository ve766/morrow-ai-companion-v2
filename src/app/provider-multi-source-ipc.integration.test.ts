/**
 * Provider profile IPC path: trusted sender → schema → service → SQLite.
 * The provider is the stack's scripted test provider, so this proves the
 * product wiring, not a real model.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestStack, type Stack } from '../../tests/helpers/companion-stack'
import { createIpcHandlers, type IpcHandler } from '../app/ipc'
import { IPC_CHANNELS } from '../shared/contracts'

const trustedUrl = 'file:///opt/morrow/out/renderer/index.html'
let directory = ''
afterEach(() => {
  if (directory) {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
    directory = ''
  }
})

function event(url = trustedUrl) {
  const frame = { url }
  return { sender: { mainFrame: frame }, senderFrame: frame }
}

function handlersFor(stack: Stack): Record<string, IpcHandler> {
  return createIpcHandlers(
    { getAppInfo: () => ({ name: 'Morrow', version: '0.0.0', platform: 'win32', electronVersion: '44.9.0', dataPolicy: 'local-first-consented-provider-egress-memory-goals-reminders' }) },
    trustedUrl,
    { memories: stack.memories, goals: {} as never, reminders: {} as never, companion: stack.companion }
  ) as Record<string, IpcHandler>
}

describe('provider profile IPC', () => {
  it('saves, lists and tests a custom profile through the typed bridge', async () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-ipc-'))
    const stack = buildTestStack({ databasePath: join(directory, 'morrow.sqlite3'), keepDatabase: true })
    try {
      const handlers = handlersFor(stack)
      const saved = await handlers[IPC_CHANNELS.providerProfileSave]!(event(), {
        displayName: 'IPC relay',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://ipc-relay.example.com/v1',
        model: 'gemini-3-flash',
        enabled: true,
        isDefault: true,
        apiKey: 'test-key-ipc'
      })
      expect(saved).toMatchObject({ ok: true, data: { displayName: 'IPC relay', sourceKind: 'custom-proxy', endpoint: 'https://ipc-relay.example.com/v1' } })
      const list = await handlers[IPC_CHANNELS.providerProfilesList]!(event(), {}) as { ok: true; data: Array<{ displayName?: string }> }
      expect(list.ok).toBe(true)
      if (!list.ok) throw new Error('list failed')
      expect(list.data.some((profile) => profile.displayName === 'IPC relay')).toBe(true)
      expect(JSON.stringify(list.data)).not.toContain('ipc-test-key-012345')

      const tested = await handlers[IPC_CHANNELS.providerTestConnection]!(event(), { providerId: (saved as { data: { id: string } }).data.id })
      expect(tested).toMatchObject({ ok: true, data: { connected: true, status: 'connected' } })
    } finally {
      stack.close()
    }
  })

  it('rejects an untrusted frame and an unsafe endpoint before the service', async () => {
    directory = mkdtempSync(join(tmpdir(), 'morrow-provider-ipc-'))
    const stack = buildTestStack({ databasePath: join(directory, 'morrow.sqlite3'), keepDatabase: true })
    try {
      const handlers = handlersFor(stack)
      const untrusted = await handlers[IPC_CHANNELS.providerProfilesList]!(event('https://attacker.invalid/'), {})
      expect(untrusted).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      const unsafe = await handlers[IPC_CHANNELS.providerProfileSave]!(event(), {
        displayName: 'Unsafe',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: 'http://127.0.0.1:1234',
        model: 'm',
        enabled: true,
        apiKey: 'test-key-ipc'
      })
      expect(unsafe).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(stack.companion.listProfiles().some((profile) => profile.displayName === 'Unsafe')).toBe(false)

      const officialOverride = await handlers[IPC_CHANNELS.providerProfileSave]!(event(), {
        profileId: 'deepseek',
        displayName: 'DeepSeek',
        sourceKind: 'official',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://api.deepseek.com',
        endpointPath: '/v1',
        model: 'deepseek-flash',
        enabled: true,
        apiKey: 'test-key-ipc'
      })
      expect(officialOverride).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
      expect(stack.companion.providers.get('deepseek')?.endpointPath ?? null).toBeNull()

      const longId = await handlers[IPC_CHANNELS.providerProfileSave]!(event(), {
        profileId: 'a'.repeat(41),
        displayName: 'Too long',
        sourceKind: 'custom-proxy',
        protocolId: 'openai-chat-completions',
        endpoint: 'https://relay.example.com',
        model: 'gemini-3-flash',
        enabled: false
      })
      expect(longId).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    } finally {
      stack.close()
    }
  })
})

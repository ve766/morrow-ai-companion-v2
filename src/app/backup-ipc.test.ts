import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import { createIpcHandlers, type BackupActions, type IpcEventLike } from './ipc'

const trustedUrl = 'file:///opt/morrow/out/renderer/index.html'

function event(url: string): IpcEventLike {
  const frame = { url }
  return { sender: { mainFrame: frame }, senderFrame: frame }
}

function createHarness(options: { url: string; backup?: BackupActions }) {
  const handlers = createIpcHandlers({ getAppInfo: () => ({
    name: 'Morrow',
    version: '0.0.0',
    platform: 'win32',
    electronVersion: '44.9.0',
    dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
  }) }, trustedUrl, {
    memories: {} as never,
    goals: {} as never,
    reminders: {} as never,
    ...(options.backup ? { backup: options.backup } : {})
  })
  return {
    call: async (channel: string, payload?: unknown) => {
      const handler = handlers[channel]
      if (!handler) throw new Error(`handler missing for ${channel}`)
      return handler(event(options.url), payload)
    }
  }
}

const fakeBackup: BackupActions = {
  exportBackup: async () => ({ status: 'created', directory: 'X:\\chosen', createdAt: '2026-10-25T00:00:00.000Z', counts: { conversations: 0, messages: 0, memories: 0, retractedMemories: 0, deletionJournalEntries: 0 } }),
  previewBackup: async () => ({ status: 'preview', token: 'a'.repeat(32), createdAt: '2026-10-25T00:00:00.000Z', schemaVersion: 11, counts: { conversations: 0, messages: 0, memories: 0, retractedMemories: 0, deletionJournalEntries: 0 }, missingDeletionJournal: false, boundaryNotice: '边界说明' }),
  restoreBackup: async () => ({ status: 'restored', schemaVersion: 11, reappliedDeletions: 0, reappliedRetractions: 0, reappliedUnretractions: 0 })
}

describe('backup IPC surface', () => {
  it('exists only when backup actions are provided', () => {
    const withoutBackup = createIpcHandlers({ getAppInfo: () => ({
      name: 'Morrow', version: '0.0.0', platform: 'win32', electronVersion: '44.9.0',
      dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
    }) }, trustedUrl, { memories: {} as never, goals: {} as never, reminders: {} as never })
    expect(withoutBackup[IPC_CHANNELS.backupExport]).toBeUndefined()
    expect(withoutBackup[IPC_CHANNELS.backupPreview]).toBeUndefined()
    expect(withoutBackup[IPC_CHANNELS.backupRestore]).toBeUndefined()
  })

  it('rejects untrusted senders on every backup channel', async () => {
    const harness = createHarness({ url: 'https://evil.example/index.html', backup: fakeBackup })
    for (const channel of [IPC_CHANNELS.backupExport, IPC_CHANNELS.backupPreview]) {
      const result = await harness.call(channel)
      expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '此请求不被允许。' } })
    }
    const restore = await harness.call(IPC_CHANNELS.backupRestore, { token: 'a'.repeat(32), confirmed: true })
    expect(restore).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '此请求不被允许。' } })
  })

  it('rejects subframe senders', async () => {
    const frame = { url: trustedUrl }
    const handlers = createIpcHandlers({ getAppInfo: () => ({
      name: 'Morrow', version: '0.0.0', platform: 'win32', electronVersion: '44.9.0',
      dataPolicy: 'local-first-consented-deepseek-egress-memory-goals-reminders'
    }) }, trustedUrl, { memories: {} as never, goals: {} as never, reminders: {} as never, backup: fakeBackup })
    const subframeEvent: IpcEventLike = { sender: { mainFrame: { url: trustedUrl } }, senderFrame: frame }
    const exportHandler = handlers[IPC_CHANNELS.backupExport]
    if (!exportHandler) throw new Error('backup export handler missing')
    const result = await exportHandler(subframeEvent, {})
    expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '此请求不被允许。' } })
  })

  it('rejects malformed restore payloads before reaching the action', async () => {
    const calls: unknown[] = []
    const harness = createHarness({
      url: trustedUrl,
      backup: { ...fakeBackup, restoreBackup: async (request) => { calls.push(request); return fakeBackup.restoreBackup(request) } }
    })
    for (const payload of [
      undefined,
      {},
      { token: 'a'.repeat(32) },
      { token: 'a'.repeat(32), confirmed: false },
      { token: 'nothex', confirmed: true },
      { token: 'a'.repeat(32), confirmed: 'yes' },
      { token: 'a'.repeat(32), confirmed: true, acknowledgeMissingDeletionJournal: false },
      { token: 'a'.repeat(32), confirmed: true, extra: 1 }
    ]) {
      const result = await harness.call(IPC_CHANNELS.backupRestore, payload)
      expect(result.ok, `payload must be rejected: ${JSON.stringify(payload)}`).toBe(false)
    }
    expect(calls).toHaveLength(0)
  })

  it('passes validated restore payloads through and reports cancelled export', async () => {
    const calls: unknown[] = []
    const harness = createHarness({
      url: trustedUrl,
      backup: {
        exportBackup: async () => ({ status: 'cancelled' }),
        previewBackup: fakeBackup.previewBackup,
        restoreBackup: async (request) => { calls.push(request); return fakeBackup.restoreBackup(request) }
      }
    })
    const exported = await harness.call(IPC_CHANNELS.backupExport, {})
    expect(exported).toEqual({ ok: true, data: { status: 'cancelled' } })
    const restored = await harness.call(IPC_CHANNELS.backupRestore, { token: 'a'.repeat(32), confirmed: true })
    expect(restored).toEqual({ ok: true, data: { status: 'restored', schemaVersion: 11, reappliedDeletions: 0, reappliedRetractions: 0, reappliedUnretractions: 0 } })
    expect(calls).toEqual([{ token: 'a'.repeat(32), confirmed: true }])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { observeRendererLoad, reportStartupFailure } from './startup-error'

describe('M0 startup error reporting', () => {
  it('shows a generic error and quits without exposing low-level details', () => {
    const actions = {
      report: vi.fn(),
      showError: vi.fn(),
      quit: vi.fn()
    }

    reportStartupFailure('application', actions)

    expect(actions.report).toHaveBeenCalledWith('application-startup-failed')
    expect(actions.showError).toHaveBeenCalledWith(
      'Morrow 启动失败',
      'Morrow 无法安全地启动或读取本机数据。请保留数据文件并重新启动；若问题仍存在，请联系支持。'
    )
    expect(actions.quit).toHaveBeenCalledOnce()
    expect(JSON.stringify(actions.showError.mock.calls)).not.toContain('database')
  })

  it('handles renderer-load rejection and ignores failure after its window closes', async () => {
    const actions = {
      report: vi.fn(),
      showError: vi.fn(),
      quit: vi.fn()
    }
    const load = Promise.reject(new Error('/private/user/path/morrow.sqlite3'))

    observeRendererLoad(load, () => true, actions)
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    expect(actions.report).toHaveBeenCalledWith('renderer-load-failed')
    expect(actions.quit).toHaveBeenCalledOnce()
    expect(JSON.stringify(actions.showError.mock.calls)).not.toContain('/private/user/path')

    const closedActions = { report: vi.fn(), showError: vi.fn(), quit: vi.fn() }
    observeRendererLoad(Promise.reject(new Error('closed window')), () => false, closedActions)
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    expect(closedActions.showError).not.toHaveBeenCalled()
    expect(closedActions.quit).not.toHaveBeenCalled()
  })
})

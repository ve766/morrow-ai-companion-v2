export type StartupFailureKind = 'application' | 'renderer'

export interface StartupFailureActions {
  report(code: 'application-startup-failed' | 'renderer-load-failed'): void
  showError(title: string, message: string): void
  quit(): void
}

const safeStartupTitle = 'Morrow 启动失败'
const safeStartupMessage = 'Morrow 无法安全地启动或读取本机数据。请保留数据文件并重新启动；若问题仍存在，请联系支持。'

export function reportStartupFailure(kind: StartupFailureKind, actions: StartupFailureActions): void {
  try {
    actions.report(kind === 'application' ? 'application-startup-failed' : 'renderer-load-failed')
  } catch {}
  try {
    actions.showError(safeStartupTitle, safeStartupMessage)
  } catch {} finally {
    try {
      actions.quit()
    } catch {}
  }
}

export function observeRendererLoad(
  load: Promise<unknown>,
  isCurrentWindow: () => boolean,
  actions: StartupFailureActions
): void {
  void load.catch(() => {
    let current = false
    try {
      current = isCurrentWindow()
    } catch {}
    if (current) reportStartupFailure('renderer', actions)
  })
}

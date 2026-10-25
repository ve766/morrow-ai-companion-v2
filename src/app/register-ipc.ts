import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createIpcHandlers, type AppInfoProvider, type IpcEventLike, type ApplicationActions } from './ipc'

let activeUnregister: (() => void) | undefined

export function registerIpcHandlers(appInfo: AppInfoProvider, trustedRendererUrl: string, actions: ApplicationActions): () => void {
  if (activeUnregister) return activeUnregister

  const handlers = createIpcHandlers(appInfo, trustedRendererUrl, actions)
  const installedChannels: string[] = []
  try {
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) =>
        handler(event as unknown as IpcEventLike, payload)
      )
      installedChannels.push(channel)
    }
  } catch (error) {
    for (const channel of installedChannels) ipcMain.removeHandler(channel)
    throw error
  }

  let registered = true
  const unregister = (): void => {
    if (!registered) return
    registered = false
    for (const channel of installedChannels) ipcMain.removeHandler(channel)
    activeUnregister = undefined
  }
  activeUnregister = unregister
  return unregister
}

import { app, BrowserWindow, shell } from 'electron'
import type { AppInfo, WindowState } from '@lookingglass/shared/ipc'
import { handle } from './typed'

export function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    platform: process.platform,
  }
}

export function getWindowState(win: BrowserWindow | null): WindowState {
  return {
    focused: win?.isFocused() ?? false,
    fullscreen: win?.isFullScreen() ?? false,
  }
}

export function registerAppHandlers(): void {
  handle('app:getInfo', () => getAppInfo())
  handle('app:openExternal', async (_e, url) => {
    // Only web links leave the app; anything else (file:, javascript:, custom schemes) is ignored.
    const protocol = new URL(url).protocol
    if (protocol === 'https:' || protocol === 'http:') await shell.openExternal(url)
  })
  handle('window:getState', (event) => getWindowState(BrowserWindow.fromWebContents(event.sender)))
}

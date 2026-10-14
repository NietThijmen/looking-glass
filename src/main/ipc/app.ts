import { app, BrowserWindow, shell } from 'electron'
import type { AppInfo, WindowState } from '@lookingglass/shared/ipc'
import { openInEditor } from '../editors/openInEditor'
import { settings } from '../state/settings'
import { handle } from './typed'
import { workspace } from './workspace'

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
  handle('app:openInEditor', async (_e, path, line, column) => {
    // `resolve` confines the path to the open folder, symlinks included.
    const abs = await workspace.resolve(path)
    await openInEditor(settings().externalEditor, abs, line, column)
  })
  handle('window:getState', (event) => getWindowState(BrowserWindow.fromWebContents(event.sender)))
}

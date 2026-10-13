import { BrowserWindow } from 'electron'
import { preloadPath, rendererEntryUrl } from './env'
import { getWindowState } from './ipc/app'
import { send } from './ipc/typed'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Lookingglass',
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // Smoke runs show the window too: focus (and so typed input) only works in a visible window.
  win.once('ready-to-show', () => win.show())

  const pushState = (): void => send(win.webContents, 'window:state', getWindowState(win))
  win.on('focus', pushState)
  win.on('blur', pushState)
  win.on('enter-full-screen', pushState)
  win.on('leave-full-screen', pushState)

  void win.loadURL(rendererEntryUrl)
  return win
}

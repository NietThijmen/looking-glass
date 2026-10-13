import { app, BrowserWindow } from 'electron'
import { isDev, isSmokeTest, rendererDir } from './env'
import { registerAgentHandlers, startAgentServices, stopAgentServices } from './ipc/agent'
import { registerAppHandlers } from './ipc/app'
import { closeWorkspace, openWorkspace, registerWorkspaceHandlers, terminals } from './ipc/workspace'
import { installMenu } from './menu'
import { applyHardening } from './security/hardening'
import { registerAppScheme, serveRenderer } from './security/protocol'
import { runSmokeTest } from './smoke'
import { loadAppState } from './state/appState'
import { createMainWindow } from './window'

app.setName('Lookingglass')
registerAppScheme()

/** Explicit workspace from `LOOKINGGLASS_WORKSPACE`, else (outside smoke runs) the last one opened. */
async function initialWorkspace(): Promise<string | undefined> {
  const explicit = process.env['LOOKINGGLASS_WORKSPACE']
  if (explicit || isSmokeTest) return explicit
  return (await loadAppState()).lastWorkspace
}

if (!isSmokeTest && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    applyHardening()
    if (!isDev) serveRenderer(rendererDir)
    registerAppHandlers()
    registerWorkspaceHandlers()
    registerAgentHandlers()
    await startAgentServices()
    installMenu()

    const root = await initialWorkspace()
    if (root) {
      await openWorkspace(root).catch((error: unknown) => {
        console.warn(`[workspace] could not reopen ${root}:`, error)
      })
    }

    const win = createMainWindow()
    if (isSmokeTest) runSmokeTest(win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Shells shouldn't outlive the window that shows them.
    terminals.killAll()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void stopAgentServices()
    void closeWorkspace()
  })
}

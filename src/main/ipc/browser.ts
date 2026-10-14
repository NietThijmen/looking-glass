import { BrowserWindow, dialog } from 'electron'
import { BrowserService } from '../browser/BrowserService'
import type { BrowserToolDeps } from '../browser/browserTools'
import { findBySuffix, previewUrl, toWorkspacePath } from '../browser/sourcePaths'
import { quickFind } from '@lookingglass/workspace'
import { broadcast } from './broadcast'
import { handle } from './typed'
import { onWorkspaceWillChange, workspace } from './workspace'

const mainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null

export const browser = new BrowserService(
  mainWindow,
  {
    state: (state) => broadcast('browser:state', state),
    console: (tabId, entry) => broadcast('browser:console', { tabId, entry }),
    picked: (item, mode) => broadcast('browser:picked', { item, mode }),
    opened: (tabId) => broadcast('browser:opened', browser.state(tabId)),
  },
  {
    toWorkspacePath: async (pathOrUrl) =>
      workspace.root ? toWorkspacePath(workspace.root, pathOrUrl) : null,
    search: async (needle) => (workspace.root ? quickFind(workspace.root, needle) : []),
    findFile: async (relative) => (workspace.root ? findBySuffix(workspace.root, relative) : null),
  },
)

/** What the `browser_*` MCP tools need. */
export const browserToolDeps: BrowserToolDeps = {
  browser,
  openTab: (url) => browser.create(url, true),
  previewUrl: async () => (workspace.root ? previewUrl(workspace.root) : null),
  allowedOrigins: new Set(),
  confirm: async (message, detail) => {
    const win = mainWindow()
    const options = {
      type: 'question' as const,
      buttons: ['Allow', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return response === 0
  },
}

export function registerBrowserHandlers(): void {
  // Tabs belong to a workspace's session of work; drop them with it.
  onWorkspaceWillChange(() => browser.closeAll())

  handle('browser:create', (_e, url) => browser.state(browser.create(url)))
  handle('browser:close', (_e, tabId) => browser.close(tabId))
  handle('browser:state', (_e, tabId) => browser.state(tabId))
  handle('browser:setBounds', (_e, tabId, bounds) => browser.setBounds(tabId, bounds))
  handle('browser:navigate', (_e, tabId, url) => browser.navigate(tabId, url))
  handle('browser:back', (_e, tabId) => browser.back(tabId))
  handle('browser:forward', (_e, tabId) => browser.forward(tabId))
  handle('browser:reload', (_e, tabId) => browser.reload(tabId))
  handle('browser:openDevTools', (_e, tabId) => browser.openDevTools(tabId))
  handle('browser:setPicking', (_e, tabId, picking) => browser.setPicking(tabId, picking))
  handle('browser:walk', (_e, tabId, direction) => browser.walk(tabId, direction))
  handle('browser:captureRegion', (_e, tabId) => browser.captureRegion(tabId))
  handle('browser:unpick', (_e, tabId, index) => browser.unpick(tabId, index))
  handle('browser:screenshot', (_e, tabId) => browser.screenshot(tabId))
  handle('browser:previewUrl', () => (workspace.root ? previewUrl(workspace.root) : null))
  handle('browser:console', (_e, tabId) => browser.consoleEntries(tabId))
  handle('browser:clearConsole', (_e, tabId) => browser.clearConsole(tabId))
  handle('browser:setAgentBlocked', (_e, tabId, blocked) => browser.setAgentBlocked(tabId, blocked))
}

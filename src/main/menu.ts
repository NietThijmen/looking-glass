import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { send } from './ipc/typed'

function command(label: string, accelerator: string, cmd: MenuCommand): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: (_item, win) => {
      const target = win instanceof BrowserWindow ? win : BrowserWindow.getFocusedWindow()
      if (target) send(target.webContents, 'menu:command', cmd)
    },
  }
}

/**
 * The app menu. Besides commands, it supplies the Edit-role items that make
 * Cmd+C/V/X/A/Z work in text inputs on macOS, and it replaces the default
 * Cmd+W (close window) with "close tab".
 */
export function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        command('Open Folder…', 'CmdOrCtrl+O', 'open-folder'),
        { type: 'separator' },
        command('Save', 'CmdOrCtrl+S', 'save'),
        command('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        command('Explorer', 'CmdOrCtrl+Shift+E', 'show-explorer'),
        command('Search', 'CmdOrCtrl+Shift+F', 'show-search'),
        command('Source Control', 'Ctrl+Shift+G', 'show-git'),
        command('Toggle Terminal', 'Ctrl+`', 'toggle-terminal'),
        { type: 'separator' },
        command('New Browser Tab', 'CmdOrCtrl+Shift+B', 'new-browser-tab'),
        command('Pick Element in Browser', 'CmdOrCtrl+Shift+C', 'toggle-picker'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

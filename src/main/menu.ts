import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@lookingglass/shared/ipc'
import { COMMANDS, keyFor } from '@lookingglass/shared/settings'
import { settings } from './state/settings'
import { updateMenuItems } from './updater'
import { send } from './ipc/typed'

function command(label: string, accelerator: string, cmd: MenuCommand): MenuItemConstructorOptions {
  return {
    label,
    ...(accelerator ? { accelerator } : {}),
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
  const prefs = settings()
  const item = (cmd: MenuCommand): MenuItemConstructorOptions => {
    const info = COMMANDS.find((c) => c.command === cmd)!
    return command(info.label, keyFor(prefs, cmd), cmd)
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              ...updateMenuItems(),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('open-folder'),
        { type: 'separator' },
        item('save'),
        item('close-tab'),
        { type: 'separator' },
        item('open-settings'),
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { label: 'Agent', submenu: [item('inline-edit')] },
    {
      label: 'View',
      submenu: [
        item('show-explorer'),
        item('show-search'),
        item('show-git'),
        item('show-commits'),
        item('show-pull-requests'),
        item('show-agents'),
        item('toggle-sidebar'),
        item('toggle-terminal'),
        { type: 'separator' },
        item('new-browser-tab'),
        item('toggle-picker'),
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
    ...(isMac || !updateMenuItems().length ? [] : [{ role: 'help' as const, submenu: updateMenuItems() }]),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

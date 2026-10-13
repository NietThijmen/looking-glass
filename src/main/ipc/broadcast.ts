import { BrowserWindow } from 'electron'
import type { EventChannel, EventContract } from '../../shared/ipc'
import { send } from './typed'

/** Send an event to every app window. */
export function broadcast<C extends EventChannel>(channel: C, payload: EventContract[C]): void {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, channel, payload)
}

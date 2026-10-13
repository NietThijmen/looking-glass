import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { EventChannel, EventContract, InvokeArgs, InvokeChannel, InvokeResult } from '../../shared/ipc'
import { rendererOrigin } from '../env'
import { hasOrigin } from '../security/paths'

type Handler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>

/** Register a handler for a contract channel. Rejects calls from any frame that isn't our renderer. */
export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!hasOrigin(event.senderFrame?.url, rendererOrigin)) {
      throw new Error(`Rejected IPC "${channel}" from untrusted sender`)
    }
    return handler(event, ...(args as InvokeArgs<C>))
  })
}

export function send<C extends EventChannel>(
  target: WebContents,
  channel: C,
  payload: EventContract[C],
): void {
  if (!target.isDestroyed()) target.send(channel, payload)
}

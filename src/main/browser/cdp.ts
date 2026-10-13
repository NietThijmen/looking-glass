import type { WebContents } from 'electron'

type Listener = (params: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A small typed-ish wrapper around `webContents.debugger` (the Chrome DevTools
 * Protocol). The picker and the agent browser tools use CDP rather than
 * injected scripts: it works across iframes and shadow DOM, and the page can't
 * see or break it.
 */
export class Cdp {
  #listeners = new Map<string, Set<Listener>>()

  constructor(private readonly contents: WebContents) {}

  attach(): void {
    const dbg = this.contents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    dbg.on('message', (_event, method, params) => {
      for (const listener of this.#listeners.get(method) ?? []) listener(params)
    })
  }

  get attached(): boolean {
    return !this.contents.isDestroyed() && this.contents.debugger.isAttached()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.attached) return Promise.reject(new Error('The browser tab is not available'))
    return this.contents.debugger.sendCommand(method, params) as Promise<T>
  }

  on(method: string, listener: Listener): () => void {
    let set = this.#listeners.get(method)
    if (!set) this.#listeners.set(method, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }
}

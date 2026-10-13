import { useBrowser } from '../store/browser'

/**
 * Routes pty output to terminal views. A shell usually prints its prompt
 * before the view that created it has attached, so output for unclaimed ids
 * is buffered until a sink attaches.
 */
type Sink = (data: string) => void

const sinks = new Map<string, Sink>()
const backlog = new Map<string, string>()
const exitListeners = new Map<string, (exitCode: number) => void>()
const recent = new Map<string, string>()
const RECENT_CHARS = 32_000

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

/** Recent output of a terminal as plain text, for @terminal mentions. */
export function recentOutput(id: string): string {
  return (recent.get(id) ?? '').replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '')
}

// Dev servers announce themselves: "Local: http://localhost:5173/".
// eslint-disable-next-line no-control-regex
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s'")\x1b]*/g

window.lookingglass.terminal.onData(({ id, data }) => {
  recent.set(id, ((recent.get(id) ?? '') + data).slice(-RECENT_CHARS))
  for (const match of data.replace(ANSI, '').matchAll(LOCAL_URL)) {
    useBrowser.getState().detectUrl(match[0].replace('0.0.0.0', 'localhost'))
  }
  const sink = sinks.get(id)
  if (sink) sink(data)
  else backlog.set(id, (backlog.get(id) ?? '') + data)
})

window.lookingglass.terminal.onExit(({ id, exitCode }) => {
  exitListeners.get(id)?.(exitCode)
})

export function attachTerminal(id: string, sink: Sink, onExit: (exitCode: number) => void): () => void {
  sinks.set(id, sink)
  exitListeners.set(id, onExit)
  const pending = backlog.get(id)
  if (pending) {
    backlog.delete(id)
    sink(pending)
  }
  return () => {
    sinks.delete(id)
    exitListeners.delete(id)
  }
}

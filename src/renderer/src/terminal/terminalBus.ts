/**
 * Routes pty output to terminal views. A shell usually prints its prompt
 * before the view that created it has attached, so output for unclaimed ids
 * is buffered until a sink attaches.
 */
type Sink = (data: string) => void

const sinks = new Map<string, Sink>()
const backlog = new Map<string, string>()
const exitListeners = new Map<string, (exitCode: number) => void>()

window.lookingglass.terminal.onData(({ id, data }) => {
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

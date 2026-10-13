import { FitAddon, init, Terminal } from 'ghostty-web'
import { useEffect, useRef, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Globe, Icon, Plus, X, iconSize } from '../ui/icon'
import { attachTerminal } from './terminalBus'

// Loads and compiles the WASM emulator once for the whole app.
let ready: Promise<void> | null = null
const ensureGhostty = (): Promise<void> => (ready ??= init())

const DARK = {
  background: '#0a0a0a',
  foreground: '#d4d4d4',
  cursor: '#009fff',
  selectionBackground: '#19283c',
}
const LIGHT = {
  background: '#ffffff',
  foreground: '#262626',
  cursor: '#0077d9',
  selectionBackground: '#cfe4fa',
}
const lightQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: light)')
const currentTheme = (): typeof DARK => (lightQuery().matches ? LIGHT : DARK)

interface Session {
  key: number
  id: string | null
  title: string
  exited: boolean
  /** Started by main (e.g. an agent login); attach instead of spawning a shell. */
  adopted?: boolean
}

function TerminalView({
  session,
  visible,
  onReady,
  onExit,
}: {
  session: Session
  visible: boolean
  onReady(id: string, title: string): void
  onExit(): void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    void ensureGhostty().then(async () => {
      if (disposed || !containerRef.current) return
      const term = new Terminal({
        fontSize: 12,
        fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
        cursorBlink: true,
        scrollback: 10_000,
        theme: currentTheme(),
      })
      const followTheme = (): void => term.renderer?.setTheme(currentTheme())
      lightQuery().addEventListener('change', followTheme)
      cleanups.push(() => lightQuery().removeEventListener('change', followTheme))
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()
      termRef.current = term
      fitRef.current = fit

      const { id, title } =
        session.adopted && session.id
          ? { id: session.id, title: session.title }
          : await window.lookingglass.terminal.create({ cols: term.cols, rows: term.rows })
      if (session.adopted) void window.lookingglass.terminal.resize(id, term.cols, term.rows)
      if (disposed) {
        void window.lookingglass.terminal.kill(id)
        term.dispose()
        return
      }
      onReady(id, title)
      cleanups.push(
        attachTerminal(
          id,
          (data) => term.write(data),
          () => onExit(),
        ),
      )
      const input = term.onData((data) => void window.lookingglass.terminal.write(id, data))
      const resize = term.onResize(
        ({ cols, rows }) => void window.lookingglass.terminal.resize(id, cols, rows),
      )
      cleanups.push(
        () => input.dispose(),
        () => resize.dispose(),
        () => void window.lookingglass.terminal.kill(id),
        () => term.dispose(),
      )
      term.focus()
    })

    return () => {
      disposed = true
      termRef.current = null
      fitRef.current = null
      for (const cleanup of cleanups.reverse()) cleanup()
    }
    // One terminal per session for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.key])

  // Refit when the panel resizes or this tab becomes visible.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) fitRef.current?.fit()
    })
    observer.observe(el)
    if (visible) termRef.current?.focus()
    return () => observer.disconnect()
  }, [visible])

  return (
    <div
      ref={containerRef}
      data-testid="terminal"
      data-terminal-id={session.id ?? ''}
      className={`absolute inset-0 overflow-hidden px-2 pt-1 ${visible ? '' : 'invisible'}`}
    />
  )
}

export function TerminalPanel() {
  const workspaceRoot = useWorkspace((s) => s.info?.root)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeKey, setActiveKey] = useState<number | null>(null)
  const nextKey = useRef(1)

  const addSession = (): void => {
    const key = nextKey.current++
    setSessions((s) => [...s, { key, id: null, title: 'shell', exited: false }])
    setActiveKey(key)
  }

  const closeSession = (key: number): void => {
    setSessions((list) => {
      const next = list.filter((s) => s.key !== key)
      setActiveKey((active) => (active === key ? (next.at(-1)?.key ?? null) : active))
      return next
    })
  }

  useEffect(
    () =>
      window.lookingglass.terminal.onOpened(({ id, title }) => {
        const key = nextKey.current++
        setSessions((list) => [...list, { key, id, title, exited: false, adopted: true }])
        setActiveKey(key)
      }),
    [],
  )

  const detectedUrl = useBrowser((s) => s.detectedUrls[0])
  const focus = useUi((s) => s.terminalFocus)
  useEffect(() => {
    if (!focus) return
    const match = sessions.find((s) => s.id === focus.id)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external request
    if (match) setActiveKey(match.key)
    // Only on new requests, not on every session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const activeId = sessions.find((s) => s.key === activeKey)?.id ?? null
  useEffect(() => useUi.getState().setActiveTerminal(activeId), [activeId])

  // Start fresh shells in the new folder when the workspace changes.
  useEffect(() => {
    const key = nextKey.current++
    setSessions([{ key, id: null, title: 'shell', exited: false }])
    setActiveKey(key)
  }, [workspaceRoot])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-[11px]">
        <span className="mr-2 font-semibold tracking-wide text-muted uppercase">Terminal</span>
        {sessions.map((s) => (
          <div
            key={s.key}
            onClick={() => setActiveKey(s.key)}
            className={`group flex cursor-default items-center gap-1 rounded px-2 py-0.5 ${
              s.key === activeKey ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            <span className={s.exited ? 'line-through' : ''}>{s.title}</span>
            <button
              aria-label="Kill terminal"
              onClick={(e) => {
                e.stopPropagation()
                closeSession(s.key)
              }}
              className="opacity-0 group-hover:opacity-100"
            >
              <Icon icon={X} className={iconSize.sm} />
            </button>
          </div>
        ))}
        <button
          aria-label="New terminal"
          onClick={addSession}
          className="rounded px-1.5 text-muted hover:text-fg"
        >
          <Icon icon={Plus} className={iconSize.sm} />
        </button>
        {detectedUrl && (
          <button
            data-testid="open-detected-url"
            onClick={() => void useEditor.getState().openBrowser(detectedUrl)}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-accent hover:bg-fg/5"
          >
            <Icon icon={Globe} className={iconSize.sm} />
            Open {detectedUrl.replace(/^https?:\/\//, '')} in browser
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {sessions.map((s) => (
          <TerminalView
            key={s.key}
            session={s}
            visible={s.key === activeKey}
            onReady={(id, title) =>
              setSessions((list) => list.map((x) => (x.key === s.key ? { ...x, id, title } : x)))
            }
            onExit={() =>
              setSessions((list) => list.map((x) => (x.key === s.key ? { ...x, exited: true } : x)))
            }
          />
        ))}
      </div>
    </div>
  )
}

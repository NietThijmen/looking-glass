import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConsoleEntry, PickedElement } from '../../../shared/browser'
import { useAgents } from '../store/agents'
import { useBrowser } from '../store/browser'
import { consoleAttachment, elementAttachment, elementLabel } from './elementAttachment'

const DEVICES = [
  { id: 'fill', label: 'Fit', size: null },
  { id: 'phone', label: 'Phone 390×844', size: { width: 390, height: 844 } },
  { id: 'tablet', label: 'Tablet 820×1180', size: { width: 820, height: 1180 } },
  { id: 'laptop', label: 'Laptop 1280×800', size: { width: 1280, height: 800 } },
] as const

function activeCaps() {
  const { chats, activeKey } = useAgents.getState()
  return chats.find((c) => c.key === activeKey)?.promptCapabilities ?? { image: true, embeddedContext: true }
}

function Toolbar({ tabId }: { tabId: string }) {
  const state = useBrowser((s) => s.tabs[tabId])
  const [url, setUrl] = useState(state?.url ?? '')
  const [editing, setEditing] = useState(false)
  const api = window.lookingglass.browser
  const shown = editing ? url : (state?.url ?? '')

  const button =
    'flex size-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-fg disabled:opacity-30'
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      <button
        className={button}
        title="Back"
        disabled={!state?.canGoBack}
        onClick={() => void api.back(tabId)}
      >
        ◀
      </button>
      <button
        className={button}
        title="Forward"
        disabled={!state?.canGoForward}
        onClick={() => void api.forward(tabId)}
      >
        ▶
      </button>
      <button className={button} title="Reload" onClick={() => void api.reload(tabId)}>
        {state?.loading ? '✕' : '⟳'}
      </button>
      <input
        data-testid="browser-url"
        value={shown}
        onFocus={(e) => {
          setUrl(state?.url ?? '')
          setEditing(true)
          e.currentTarget.select()
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void api.navigate(tabId, url)
            e.currentTarget.blur()
          }
        }}
        className="mx-1 h-6 min-w-0 flex-1 rounded border border-border bg-bg px-2 font-mono text-[12px] outline-none select-text focus:border-accent"
      />
      <button
        data-testid="picker-toggle"
        title="Pick an element (⇧⌘C)"
        aria-pressed={state?.picking}
        onClick={() => void api.setPicking(tabId, !state?.picking)}
        className={`${button} ${state?.picking ? 'bg-accent/30 text-fg' : ''}`}
      >
        ⌖
      </button>
      <button className={button} title="Open DevTools" onClick={() => void api.openDevTools(tabId)}>
        ⚙
      </button>
    </div>
  )
}

function PickedBar({ tabId, element }: { tabId: string; element: PickedElement }) {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [element])

  const dismiss = (): void => {
    useBrowser.getState().setPicked(tabId, null)
    void window.lookingglass.browser.clearSelection(tabId)
  }
  const source = element.sources[0]

  return (
    <div className="shrink-0 border-b border-border bg-panel px-2 py-1.5" data-testid="picked-bar">
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="rounded bg-accent/20 px-1.5 font-mono text-fg" data-testid="picked-label">
          ⌖ {elementLabel(element)}
        </span>
        <span className="text-muted">
          {element.rect.width}×{element.rect.height}
        </span>
        {source && (
          <span className="truncate font-mono text-muted" title={`via ${source.via}`}>
            {source.via === 'search' ? 'maybe ' : ''}
            {source.path}
            {source.line ? `:${source.line}` : ''}
          </span>
        )}
        <span className="ml-auto" />
        <button
          title="Select the parent element"
          className="text-muted hover:text-fg"
          onClick={() =>
            void window.lookingglass.browser
              .pickParent(tabId)
              .then((parent) => parent && useBrowser.getState().setPicked(tabId, parent))
          }
        >
          ↑ parent
        </button>
        <button title="Clear" className="text-muted hover:text-fg" onClick={dismiss}>
          ✕
        </button>
      </div>
      <input
        ref={inputRef}
        data-testid="ask-element"
        value={question}
        placeholder="Ask about this element…  (Enter: send · ⌘Enter: new chat · Esc: add to chat)"
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          const attachment = (): ReturnType<typeof elementAttachment> =>
            elementAttachment(element, activeCaps())
          if (e.key === 'Enter' && question.trim()) {
            e.preventDefault()
            void useAgents.getState().ask(question, [attachment()], { newChat: e.metaKey || e.ctrlKey })
            setQuestion('')
            dismiss()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            void useAgents.getState().addPending(attachment())
            dismiss()
          }
        }}
        className="h-7 w-full rounded border border-border bg-bg px-2 outline-none select-text focus:border-accent"
      />
    </div>
  )
}

const levelStyle: Record<ConsoleEntry['level'], string> = {
  error: 'text-red-400',
  warning: 'text-amber-300',
  info: 'text-sky-300',
  log: 'text-muted',
}

function ConsolePanel({ tabId }: { tabId: string }) {
  const entries = useBrowser((s) => s.console[tabId]) ?? []
  const [open, setOpen] = useState(false)
  const errors = entries.filter((e) => e.level === 'error').length
  const warnings = entries.filter((e) => e.level === 'warning').length
  return (
    <div className="shrink-0 border-t border-border bg-panel" data-testid="browser-console">
      <div className="flex h-7 items-center gap-3 px-2 text-[11px]">
        <button className="text-muted hover:text-fg" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} CONSOLE
        </button>
        <span className="text-red-400" data-testid="console-errors">
          ✖ {errors}
        </span>
        <span className="text-amber-300">⚠ {warnings}</span>
        <span className="ml-auto" />
        {errors > 0 && (
          <button
            className="text-accent hover:underline"
            onClick={() =>
              void useAgents.getState().addPending(
                consoleAttachment(
                  entries.filter((e) => e.level === 'error'),
                  'console errors',
                ),
              )
            }
          >
            Add errors to chat
          </button>
        )}
        <button
          className="text-muted hover:text-fg"
          onClick={() => {
            useBrowser.getState().clearConsole(tabId)
            void window.lookingglass.browser.clearConsole(tabId)
          }}
        >
          Clear
        </button>
      </div>
      {open && (
        <div className="max-h-40 overflow-auto border-t border-border font-mono text-[11px]">
          {entries.length === 0 && <div className="px-2 py-1 text-muted">No messages.</div>}
          {entries.map((e) => (
            <div key={e.id} className="group flex gap-2 border-b border-border/50 px-2 py-0.5">
              <span
                className={`min-w-0 flex-1 break-all whitespace-pre-wrap select-text ${levelStyle[e.level]}`}
              >
                {e.text}
              </span>
              {e.url && (
                <span className="shrink-0 truncate text-muted">
                  {e.url.split('/').pop()}
                  {e.line ? `:${e.line}` : ''}
                </span>
              )}
              <button
                className="hidden shrink-0 text-accent group-hover:block"
                onClick={() =>
                  void useAgents.getState().addPending(consoleAttachment([e], 'console message'))
                }
              >
                + chat
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentBanner({ tabId }: { tabId: string }) {
  const state = useBrowser((s) => s.tabs[tabId])
  if (!state?.agentActive && !state?.agentBlocked) return null
  return (
    <div
      data-testid="agent-banner"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-accent/10 px-3 py-1 text-[12px]"
    >
      {state.agentBlocked ? (
        <>
          Agent control of this tab is stopped.
          <button
            className="underline"
            onClick={() => void window.lookingglass.browser.setAgentBlocked(tabId, false)}
          >
            Allow again
          </button>
        </>
      ) : (
        <>
          <span className="text-accent">●</span> An agent is using this tab.
          <button
            data-testid="agent-stop"
            className="underline"
            onClick={() => void window.lookingglass.browser.setAgentBlocked(tabId, true)}
          >
            Stop
          </button>
        </>
      )}
    </div>
  )
}

/**
 * A browser tab. The page itself is a WebContentsView drawn by main on top of
 * the window; this component reserves its space and keeps main's bounds in sync.
 */
export function BrowserTab({ tabId }: { tabId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const picked = useBrowser((s) => s.picked[tabId])
  const [device, setDevice] = useState<(typeof DEVICES)[number]['id']>('fill')

  useEffect(() => {
    useBrowser.getState().setLastTab(tabId)
    void window.lookingglass.browser.state(tabId).then((s) => useBrowser.getState().setState(s))
  }, [tabId])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      void window.lookingglass.browser.setBounds(tabId, { x: r.x, y: r.y, width: r.width, height: r.height })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      void window.lookingglass.browser.setBounds(tabId, null)
    }
  }, [tabId, device, picked])

  const size = DEVICES.find((d) => d.id === device)?.size

  return (
    <div className="flex h-full flex-col" data-testid="browser-tab" data-tab-id={tabId}>
      <Toolbar tabId={tabId} />
      <AgentBanner tabId={tabId} />
      {picked && <PickedBar tabId={tabId} element={picked} />}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-[#1f1f1f]">
        <div
          ref={viewportRef}
          data-testid="browser-viewport"
          style={
            size ? { width: size.width, height: size.height, maxWidth: '100%', maxHeight: '100%' } : undefined
          }
          className={size ? 'shrink-0' : 'h-full w-full'}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border bg-panel px-2 py-0.5 text-[11px]">
        {DEVICES.map((d) => (
          <button
            key={d.id}
            onClick={() => setDevice(d.id)}
            className={`rounded px-1.5 ${device === d.id ? 'bg-white/10 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <ConsolePanel tabId={tabId} />
    </div>
  )
}

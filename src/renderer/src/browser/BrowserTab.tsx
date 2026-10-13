import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConsoleEntry, Picked } from '../../../shared/browser'
import { useAgents } from '../store/agents'
import { useBrowser } from '../store/browser'
import { useShortcut } from '../store/settings'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Chevron,
  Crosshair,
  Icon,
  RotateCw,
  Settings,
  SquareDashed,
  StatusDot,
  X,
  XCircle,
  iconSize,
} from '../ui/icon'
import { consoleAttachment, pickedAttachment, pickedLabel } from './elementAttachment'

const NO_PICKS: Picked[] = []
/** Recent console errors offered (unticked) with the last picked item. */
const MAX_PICK_ERRORS = 20

const DEVICES = [
  { id: 'fill', label: 'Fit', size: null },
  { id: 'phone', label: 'Phone 390×844', size: { width: 390, height: 844 } },
  { id: 'tablet', label: 'Tablet 820×1180', size: { width: 820, height: 1180 } },
  { id: 'laptop', label: 'Laptop 1280×800', size: { width: 1280, height: 800 } },
] as const

function activeCaps() {
  const { chats, sidebarKey } = useAgents.getState()
  return chats.find((c) => c.key === sidebarKey)?.promptCapabilities ?? { image: true, embeddedContext: true }
}

function Toolbar({ tabId }: { tabId: string }) {
  const state = useBrowser((s) => s.tabs[tabId])
  const [url, setUrl] = useState(state?.url ?? '')
  const [editing, setEditing] = useState(false)
  const api = window.lookingglass.browser
  const shown = editing ? url : (state?.url ?? '')
  const pickHint = useShortcut('toggle-picker')

  const button =
    'flex size-6 items-center justify-center rounded text-muted hover:bg-fg/10 hover:text-fg disabled:opacity-30'
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      <button
        className={button}
        title="Back"
        disabled={!state?.canGoBack}
        onClick={() => void api.back(tabId)}
      >
        <Icon icon={ArrowLeft} className={iconSize.md} />
      </button>
      <button
        className={button}
        title="Forward"
        disabled={!state?.canGoForward}
        onClick={() => void api.forward(tabId)}
      >
        <Icon icon={ArrowRight} className={iconSize.md} />
      </button>
      <button className={button} title="Reload" onClick={() => void api.reload(tabId)}>
        {state?.loading ? (
          <Icon icon={X} className={iconSize.md} />
        ) : (
          <Icon icon={RotateCw} className={iconSize.md} />
        )}
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
        title={`Pick an element (${pickHint})`}
        aria-pressed={state?.picking}
        onClick={() => void api.setPicking(tabId, !state?.picking)}
        className={`${button} ${state?.picking ? 'bg-accent/30 text-fg' : ''}`}
      >
        <Icon icon={Crosshair} className={iconSize.md} />
      </button>
      <button
        data-testid="region-capture"
        title="Capture a region (⇧-click to add to the selection)"
        aria-pressed={state?.capturing}
        disabled={state?.capturing}
        onClick={() => void api.captureRegion(tabId)}
        className={`${button} ${state?.capturing ? 'bg-accent/30 text-fg' : ''}`}
      >
        <Icon icon={SquareDashed} className={iconSize.md} />
      </button>
      <button className={button} title="Open DevTools" onClick={() => void api.openDevTools(tabId)}>
        <Icon icon={Settings} className={iconSize.md} />
      </button>
    </div>
  )
}

function PickedBar({ tabId, items }: { tabId: string; items: Picked[] }) {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const last = items.at(-1)
  useEffect(() => inputRef.current?.focus(), [last])
  if (!last) return null

  const api = window.lookingglass.browser
  const dismiss = (index?: number): void => {
    useBrowser.getState().unpick(tabId, index)
    void api.unpick(tabId, index)
  }
  const walk = (direction: 'parent' | 'child'): void => void api.walk(tabId, direction)
  const attachments = (): ReturnType<typeof pickedAttachment>[] => {
    const errors = (useBrowser.getState().console[tabId] ?? [])
      .filter((e) => e.level === 'error')
      .slice(-MAX_PICK_ERRORS)
    return items.map((item, i) => pickedAttachment(item, activeCaps(), i === items.length - 1 ? errors : []))
  }
  const source = last.kind === 'element' ? last.sources[0] : undefined
  const subject = items.length > 1 ? 'these' : last.kind === 'region' ? 'this region' : 'this element'
  const walkButton = 'inline-flex items-center gap-0.5 text-muted hover:text-fg'

  return (
    <div className="shrink-0 border-b border-border bg-panel px-2 py-1.5" data-testid="picked-bar">
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {items.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded bg-accent/20 px-1.5 font-mono text-fg"
              data-testid="picked-label"
            >
              <Icon icon={item.kind === 'region' ? SquareDashed : Crosshair} className={iconSize.xs} />
              {pickedLabel(item)}
              {items.length > 1 && (
                <button aria-label="Remove" className="text-muted hover:text-fg" onClick={() => dismiss(i)}>
                  <Icon icon={X} className={iconSize.xs} />
                </button>
              )}
            </span>
          ))}
        </div>
        {last.kind === 'element' && (
          <span className="shrink-0 text-muted">
            {last.rect.width}×{last.rect.height}
          </span>
        )}
        {source && (
          <span className="truncate font-mono text-muted" title={`via ${source.via}`}>
            {source.via === 'search' ? 'maybe ' : ''}
            {source.path}
            {source.line ? `:${source.line}` : ''}
          </span>
        )}
        <span className="ml-auto" />
        {last.kind === 'element' && (
          <>
            <button
              title="Select the parent element (↑)"
              className={walkButton}
              onClick={() => walk('parent')}
            >
              <Icon icon={ArrowUp} className={iconSize.xs} />
              parent
            </button>
            <button title="Select a child element (↓)" className={walkButton} onClick={() => walk('child')}>
              <Icon icon={ArrowDown} className={iconSize.xs} />
              child
            </button>
          </>
        )}
        <button title="Clear" className="text-muted hover:text-fg" onClick={() => dismiss()}>
          <Icon icon={X} className={iconSize.sm} />
        </button>
      </div>
      <input
        ref={inputRef}
        data-testid="ask-element"
        value={question}
        placeholder={`Ask about ${subject}…  (Enter: send · ⌘Enter: new chat · Esc: add to chat · ↑↓: parent/child)`}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          // Plain arrows walk while the question is empty; ⌥ arrows walk any time.
          const arrows = e.key === 'ArrowUp' || e.key === 'ArrowDown'
          if (arrows && last.kind === 'element' && (e.altKey || !question)) {
            e.preventDefault()
            walk(e.key === 'ArrowUp' ? 'parent' : 'child')
          } else if (e.key === 'Enter' && question.trim()) {
            e.preventDefault()
            void useAgents.getState().ask(question, attachments(), { newChat: e.metaKey || e.ctrlKey })
            setQuestion('')
            dismiss()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            // One at a time: the first may start a chat the rest should join.
            const pending = attachments()
            void (async () => {
              for (const a of pending) await useAgents.getState().addPending(a)
            })()
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
        <button
          className="inline-flex items-center gap-1 text-muted hover:text-fg"
          onClick={() => setOpen((v) => !v)}
        >
          <Chevron open={open} />
          CONSOLE
        </button>
        <span className="inline-flex items-center gap-1 text-red-400" data-testid="console-errors">
          <Icon icon={XCircle} className={iconSize.xs} />
          {errors}
        </span>
        <span className="inline-flex items-center gap-1 text-amber-300">
          <Icon icon={AlertTriangle} className={iconSize.xs} />
          {warnings}
        </span>
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
          <StatusDot className="text-accent" /> An agent is using this tab.
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
  const picked = useBrowser((s) => s.picked[tabId] ?? NO_PICKS)
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
      {picked.length > 0 && <PickedBar tabId={tabId} items={picked} />}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-panel">
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
            className={`rounded px-1.5 ${device === d.id ? 'bg-fg/10 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <ConsolePanel tabId={tabId} />
    </div>
  )
}

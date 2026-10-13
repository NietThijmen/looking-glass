import { Bot } from 'lucide-react'
import { useState } from 'react'
import { AgentTab, NewChatMenu, StartChat, useChatLabel } from '../agent/AgentPanel'
import { HistoryMenu } from '../agent/HistoryMenu'
import { basename } from '../lib/paths'
import { useAgents } from '../store/agents'
import { agentTabKey, isDirty, useEditor, type Tab } from '../store/editor'
import { useWorkspace } from '../store/workspace'
import { CodeEditor } from './CodeEditor'
import { BrowserTab } from '../browser/BrowserTab'
import { ReviewView } from '../review/ReviewView'
import { useBrowser } from '../store/browser'
import { useReview } from '../store/review'
import { SettingsView } from '../settings/SettingsView'
import { useShortcut } from '../store/settings'
import { Diff, Globe, History, Icon, Plus, Settings, Sparkles, StatusDot, X, iconSize } from '../ui/icon'
import { GitDiffView } from './GitDiffView'

function TabLabel({ tab }: { tab: Tab }) {
  const dirty = useEditor((s) => isDirty(s.buffers[tab.path]))
  const active = useEditor((s) => s.activeId === tab.id)
  const browserTitle = useBrowser((s) =>
    tab.kind === 'browser' ? s.tabs[tab.path]?.title || s.tabs[tab.path]?.url : undefined,
  )
  const chat = useAgents((s) =>
    tab.kind === 'agent' ? s.chats.find((c) => c.key === agentTabKey(tab)) : undefined,
  )
  const chatLabel = useChatLabel(chat)
  const label =
    tab.kind === 'browser'
      ? browserTitle || 'New tab'
      : tab.kind === 'settings'
        ? 'Settings'
        : tab.kind === 'agent'
          ? chatLabel
          : basename(tab.path)
  const { activate, closeTab } = useEditor.getState()
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="editor-tab"
      data-path={tab.path}
      data-dirty={dirty}
      title={tab.kind === 'agent' ? chatLabel : tab.path}
      onMouseDown={(e) => {
        if (e.button === 1) closeTab(tab.id)
        else activate(tab.id)
      }}
      className={`group flex h-full max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-border px-3 ${
        active ? 'bg-bg text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {tab.kind === 'diff' && <Icon icon={Diff} className={`${iconSize.sm} text-accent`} />}
      {tab.kind === 'review' && <Icon icon={Sparkles} className={`${iconSize.sm} text-amber-300`} />}
      {tab.kind === 'browser' && <Icon icon={Globe} className={iconSize.sm} />}
      {tab.kind === 'settings' && <Icon icon={Settings} className={iconSize.sm} />}
      {tab.kind === 'agent' &&
        (chat?.busy ? (
          <StatusDot className="text-accent" />
        ) : (
          <Icon icon={Bot} className={`${iconSize.sm} text-accent`} />
        ))}
      <span className="truncate">{label}</span>
      <button
        aria-label={tab.kind === 'agent' ? 'Close chat' : 'Close tab'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => closeTab(tab.id)}
        className="no-drag flex size-4 items-center justify-center rounded hover:bg-border"
      >
        {dirty ? (
          <span className="size-2 rounded-full bg-fg group-hover:hidden" />
        ) : (
          <Icon icon={X} className={`${iconSize.sm} opacity-0 group-hover:opacity-100`} />
        )}
        {dirty && <Icon icon={X} className={`${iconSize.sm} hidden group-hover:inline`} />}
      </button>
    </div>
  )
}

export function openBrowserTab(): void {
  void useEditor.getState().openBrowser(useBrowser.getState().detectedUrls[0] ?? 'about:blank')
}

function ShortcutHints() {
  const open = useShortcut('open-folder')
  const search = useShortcut('show-search')
  const terminal = useShortcut('toggle-terminal')
  const browser = useShortcut('new-browser-tab')
  const edit = useShortcut('inline-edit')
  return (
    <div className="mt-4 font-mono text-[11px]">
      {open} open folder · {search} search · {terminal} terminal · {browser} browser · {edit} edit with agent
    </div>
  )
}

function NewBrowserTabButton({ labelled = false }: { labelled?: boolean }) {
  const hint = useShortcut('new-browser-tab')
  return (
    <button
      data-testid="new-browser-tab"
      title={`New browser tab (${hint})`}
      onClick={openBrowserTab}
      className={
        labelled
          ? 'rounded border border-border px-3 py-1 hover:bg-fg/5'
          : 'shrink-0 px-3 text-muted hover:text-fg'
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon icon={Globe} className={iconSize.sm} />
        {labelled ? 'Open browser' : null}
      </span>
    </button>
  )
}

/** New chat and earlier sessions, opened as tabs. */
function ChatTabButtons() {
  const hasWorkspace = useWorkspace((s) => !!s.info)
  const [menu, setMenu] = useState<'new' | 'history' | null>(null)
  const toggle = (which: 'new' | 'history'): void => setMenu((m) => (m === which ? null : which))
  return (
    <div className="relative flex shrink-0 items-center">
      <button
        data-testid="tab-new-chat"
        disabled={!hasWorkspace}
        title="New chat tab"
        onClick={() => toggle('new')}
        className="inline-flex h-full items-center gap-0.5 px-2 text-muted hover:text-fg disabled:opacity-40"
      >
        <Icon icon={Plus} className={iconSize.xs} />
        <Icon icon={Bot} className={iconSize.sm} />
      </button>
      <button
        data-testid="tab-history"
        disabled={!hasWorkspace}
        title="Resume an earlier session in a tab"
        onClick={() => toggle('history')}
        className="h-full px-2 text-muted hover:text-fg disabled:opacity-40"
      >
        <Icon icon={History} className={iconSize.sm} />
      </button>
      {menu === 'new' && <NewChatMenu placement="tab" onClose={() => setMenu(null)} />}
      {menu === 'history' && <HistoryMenu placement="tab" onClose={() => setMenu(null)} />}
    </div>
  )
}

function ActiveTab({ tab }: { tab: Tab }) {
  const buffer = useEditor((s) => s.buffers[tab.path])
  const error = useEditor((s) => s.errors[tab.path])
  const { reloadFromDisk } = useEditor.getState()
  const underReview = useReview((s) => s.entries.some((e) => e.path === tab.path))

  if (tab.kind === 'diff') return <GitDiffView path={tab.path} />
  if (tab.kind === 'review') return <ReviewView path={tab.path} />
  if (tab.kind === 'browser') return <BrowserTab tabId={tab.path} />
  if (tab.kind === 'settings') return <SettingsView />
  if (tab.kind === 'agent') return <AgentTab chatKey={agentTabKey(tab)} />
  if (error)
    return (
      <div className="p-4 text-red-400">
        Could not open {tab.path}: {error}
      </div>
    )
  if (!buffer) return <div className="p-4 text-muted">Loading…</div>
  if (buffer.binary) return <div className="p-4 text-muted">Binary file, not shown.</div>
  if (buffer.tooLarge) return <div className="p-4 text-muted">File is too large to open (over 5 MB).</div>

  return (
    <div className="flex h-full flex-col">
      {underReview && (
        <div
          data-testid="review-banner"
          className="flex items-center gap-3 border-b border-border bg-amber-400/5 px-3 py-1.5 text-amber-200"
        >
          An agent changed this file.
          <button className="underline" onClick={() => useEditor.getState().openReview(tab.path)}>
            Review changes
          </button>
          <button className="underline" onClick={() => void window.lookingglass.review.accept(tab.path)}>
            Keep
          </button>
          <button className="underline" onClick={() => void window.lookingglass.review.reject(tab.path)}>
            Undo
          </button>
        </div>
      )}
      {buffer.conflict && (
        <div className="flex items-center gap-3 border-b border-border bg-amber-500/10 px-3 py-1.5 text-amber-200">
          This file changed on disk and you have unsaved edits.
          <button className="underline" onClick={() => void reloadFromDisk(tab.path)}>
            Discard mine and reload
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1" data-testid="code-editor" data-path={tab.path}>
        <CodeEditor path={tab.path} buffer={buffer} />
      </div>
    </div>
  )
}

function pickActiveTab(tabs: Tab[], activeId: string | null): Tab | undefined {
  if (!tabs.length) return undefined
  return tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1]
}

/** The main pane: browser, code and chat tabs side by side in one tab bar. */
export function EditorArea() {
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const active = pickActiveTab(tabs, activeId)

  if (!tabs.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="w-80 text-center">
          <div className="text-lg text-fg">Lookingglass</div>
          <div className="mt-1">Open a page, a file from the explorer, or a chat.</div>
          <ShortcutHints />
          <div className="mt-3">
            <NewBrowserTabButton labelled />
          </div>
          <div className="mt-6 text-left">
            <StartChat placement="tab" testId="welcome-start-agent" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 border-b border-border bg-panel">
        <div role="tablist" className="flex min-w-0 overflow-x-auto">
          {tabs.map((tab) => (
            <TabLabel key={tab.id} tab={tab} />
          ))}
        </div>
        <NewBrowserTabButton />
        <ChatTabButtons />
      </div>
      <div className="min-h-0 flex-1">{active && <ActiveTab key={active.id} tab={active} />}</div>
    </div>
  )
}

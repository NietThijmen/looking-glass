import { basename } from '../lib/paths'
import { isDirty, useEditor, type Tab } from '../store/editor'
import { CodeEditor } from './CodeEditor'
import { GitDiffView } from './GitDiffView'

function TabLabel({ tab }: { tab: Tab }) {
  const dirty = useEditor((s) => isDirty(s.buffers[tab.path]))
  const active = useEditor((s) => s.activeId === tab.id)
  const { activate, closeTab } = useEditor.getState()
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="editor-tab"
      data-path={tab.path}
      data-dirty={dirty}
      title={tab.path}
      onMouseDown={(e) => {
        if (e.button === 1) closeTab(tab.id)
        else activate(tab.id)
      }}
      className={`group flex h-full max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-border px-3 ${
        active ? 'bg-bg text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {tab.kind === 'diff' && <span className="text-accent">±</span>}
      <span className="truncate">{basename(tab.path)}</span>
      <button
        aria-label="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => closeTab(tab.id)}
        className="no-drag flex size-4 items-center justify-center rounded hover:bg-border"
      >
        {dirty ? (
          <span className="size-2 rounded-full bg-fg group-hover:hidden" />
        ) : (
          <span className="opacity-0 group-hover:opacity-100">×</span>
        )}
        {dirty && <span className="hidden group-hover:inline">×</span>}
      </button>
    </div>
  )
}

function ActiveTab({ tab }: { tab: Tab }) {
  const buffer = useEditor((s) => s.buffers[tab.path])
  const error = useEditor((s) => s.errors[tab.path])
  const { reloadFromDisk } = useEditor.getState()

  if (tab.kind === 'diff') return <GitDiffView path={tab.path} />
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

export function EditorArea() {
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const active = tabs.find((t) => t.id === activeId)

  if (!tabs.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <div className="text-center">
          <div className="text-lg text-fg">Lookingglass</div>
          <div className="mt-1">Open a file from the explorer.</div>
          <div className="mt-4 font-mono text-[11px]">⌘O open folder · ⇧⌘F search · ⌃` terminal</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-panel">
        {tabs.map((tab) => (
          <TabLabel key={tab.id} tab={tab} />
        ))}
      </div>
      <div className="min-h-0 flex-1">{active && <ActiveTab key={active.id} tab={active} />}</div>
    </div>
  )
}

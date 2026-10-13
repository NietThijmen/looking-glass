import type { DirEntry } from '../../../shared/ipc'
import { gitColor, gitLetter } from '../lib/gitColors'
import { useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useWorkspace } from '../store/workspace'

const INDENT = 12

function Row({ entry, depth }: { entry: DirEntry; depth: number }) {
  const expanded = useWorkspace((s) => !!s.expanded[entry.path])
  const status = useWorkspace((s) => s.gitByPath[entry.path])
  const reviewed = useReview((s) =>
    s.entries.some((e) => e.path === entry.path || e.path.startsWith(entry.path + '/')),
  )
  const active = useEditor((s) => s.tabs.find((t) => t.id === s.activeId)?.path === entry.path)
  const isDir = entry.kind === 'dir'

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        data-testid="tree-item"
        data-path={entry.path}
        onClick={() =>
          isDir
            ? useWorkspace.getState().toggleDir(entry.path)
            : void useEditor.getState().openFile(entry.path)
        }
        style={{ paddingLeft: 8 + depth * INDENT }}
        className={`flex h-[22px] cursor-default items-center gap-1 pr-2 ${
          active ? 'bg-accent/15 text-fg' : 'hover:bg-white/5'
        }`}
      >
        <span className="w-3 shrink-0 text-center text-[10px] text-muted">
          {isDir ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span className={`truncate ${status ? gitColor[status] : ''}`}>{entry.name}</span>
        {reviewed && (
          <span title="Agent changes to review" className="text-[10px] text-amber-300">
            ✦
          </span>
        )}
        {status && !isDir && (
          <span className={`ml-auto pl-2 font-mono text-[10px] ${gitColor[status]}`}>
            {gitLetter[status]}
          </span>
        )}
        {status && isDir && (
          <span className={`ml-auto size-1.5 shrink-0 rounded-full bg-current ${gitColor[status]}`} />
        )}
      </div>
      {isDir && expanded && <Children path={entry.path} depth={depth + 1} />}
    </>
  )
}

function Children({ path, depth }: { path: string; depth: number }) {
  const entries = useWorkspace((s) => s.children[path])
  if (!entries) {
    return (
      <div style={{ paddingLeft: 8 + depth * INDENT + 16 }} className="h-[22px] text-muted">
        …
      </div>
    )
  }
  return entries.map((entry) => <Row key={entry.path} entry={entry} depth={depth} />)
}

export function Explorer() {
  const info = useWorkspace((s) => s.info)

  if (!info) {
    return (
      <div className="p-3 text-muted">
        <p>No folder open.</p>
        <button
          className="mt-3 rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
          onClick={() => void window.lookingglass.workspace.openDialog()}
        >
          Open Folder…
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {info.name}
      </div>
      <div role="tree" data-testid="explorer" className="min-h-0 flex-1 overflow-auto pb-4">
        <Children path="" depth={0} />
      </div>
    </div>
  )
}

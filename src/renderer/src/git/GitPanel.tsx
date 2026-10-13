import type { GitStatusEntry } from '../../../shared/ipc'
import { gitColor, gitLetter } from '../lib/gitColors'
import { basename, dirname } from '../lib/paths'
import { useEditor } from '../store/editor'
import { useWorkspace } from '../store/workspace'

function Entry({ entry }: { entry: GitStatusEntry }) {
  return (
    <div
      data-testid="git-entry"
      data-path={entry.path}
      title={entry.from ? `${entry.from} → ${entry.path}` : entry.path}
      onClick={() => void useEditor.getState().openDiff(entry.path)}
      className="flex h-[22px] cursor-default items-center gap-1.5 px-3 hover:bg-white/5"
    >
      <span
        className={`truncate ${gitColor[entry.status]} ${entry.status === 'deleted' ? 'line-through' : ''}`}
      >
        {basename(entry.path)}
      </span>
      <span className="truncate text-[11px] text-muted">{dirname(entry.path)}</span>
      <span className={`ml-auto pl-2 font-mono text-[10px] ${gitColor[entry.status]}`}>
        {entry.staged ? '●' : ''}
        {gitLetter[entry.status]}
      </span>
    </div>
  )
}

export function GitPanel() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)

  if (!info) return <div className="p-3 text-muted">No folder open.</div>
  if (!git) return <div className="p-3 text-muted">This folder isn't a git repository.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Changes
        <span className="ml-auto font-normal normal-case">{git.branch ?? 'detached HEAD'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-4" data-testid="git-panel">
        {git.entries.length === 0 && <div className="px-3 text-muted">No changes.</div>}
        {git.entries.map((entry) => (
          <Entry key={entry.path} entry={entry} />
        ))}
      </div>
    </div>
  )
}

import { useWorkspace } from '../store/workspace'
import { ExplorerTree } from './ExplorerTree'

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
      <ExplorerTree />
    </div>
  )
}

import type { LucideIcon } from 'lucide-react'
import { Files, GitBranch, Search } from 'lucide-react'
import { Explorer } from '../explorer/Explorer'
import { GitPanel } from '../git/GitPanel'
import { SearchPanel } from '../search/SearchPanel'
import { useUi, type SidebarView } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Icon, iconSize } from '../ui/icon'

const views: Array<{ id: SidebarView; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'explorer', label: 'Explorer', icon: Files, hint: '⇧⌘E' },
  { id: 'search', label: 'Search', icon: Search, hint: '⇧⌘F' },
  { id: 'git', label: 'Source Control', icon: GitBranch, hint: '⌃⇧G' },
]

export function ActivityBar() {
  const current = useUi((s) => s.sidebar)
  const changes = useWorkspace((s) => s.git?.entries.length ?? 0)
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel pt-2">
      {views.map((v) => (
        <button
          key={v.id}
          title={`${v.label} (${v.hint})`}
          aria-pressed={current === v.id}
          data-testid={`activity-${v.id}`}
          onClick={() => useUi.getState().showSidebar(v.id)}
          className={`relative flex size-9 items-center justify-center rounded ${
            current === v.id ? 'text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          <Icon icon={v.icon} className={iconSize.lg} />
          {v.id === 'git' && changes > 0 && (
            <span className="absolute right-0.5 bottom-0.5 rounded-full bg-accent px-1 text-[9px] leading-tight text-bg">
              {changes > 99 ? '99+' : changes}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}

export function Sidebar() {
  const current = useUi((s) => s.sidebar)
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-panel">
      {/* Keep panels mounted so search state survives switching views. */}
      <div className={current === 'explorer' ? 'h-full' : 'hidden'}>
        <Explorer />
      </div>
      <div className={current === 'search' ? 'h-full' : 'hidden'}>
        <SearchPanel />
      </div>
      <div className={current === 'git' ? 'h-full' : 'hidden'}>
        <GitPanel />
      </div>
    </aside>
  )
}

import type { LucideIcon } from 'lucide-react'
import { Bot, Files, GitBranch, GitPullRequest, History, Search, Settings } from 'lucide-react'
import type { MenuCommand } from '@lookingglass/shared/ipc'
import { AgentsSidebar } from '../agent/AgentPanel'
import { CommitsPanel } from '../git/CommitsPanel'
import { Explorer } from '../explorer/Explorer'
import { GitPanel } from '../git/GitPanel'
import { PullRequestsPanel } from '../git/PullRequestsPanel'
import { SearchPanel } from '../search/SearchPanel'
import { useAgents } from '../store/agents'
import { useEditor } from '../store/editor'
import { useShortcut } from '../store/settings'
import { useUi, type SidebarView } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Icon, iconSize } from '../ui/icon'

const views: Array<{ id: SidebarView; label: string; icon: LucideIcon; command: MenuCommand }> = [
  { id: 'explorer', label: 'Explorer', icon: Files, command: 'show-explorer' },
  { id: 'search', label: 'Search', icon: Search, command: 'show-search' },
  { id: 'git', label: 'Source Control', icon: GitBranch, command: 'show-git' },
  { id: 'commits', label: 'Commits', icon: History, command: 'show-commits' },
  { id: 'pullRequests', label: 'Pull Requests', icon: GitPullRequest, command: 'show-pull-requests' },
  { id: 'agents', label: 'Agents', icon: Bot, command: 'show-agents' },
]

function ActivityButton({ view: v, changes }: { view: (typeof views)[number]; changes: number }) {
  const active = useUi((s) => s.layout.sidebarOpen && s.sidebar === v.id)
  const busy = useAgents((s) => v.id === 'agents' && s.chats.some((c) => c.key === s.sidebarKey && c.busy))
  const hint = useShortcut(v.command)
  return (
    <button
      title={`${v.label} (${hint})`}
      aria-pressed={active}
      data-testid={`activity-${v.id}`}
      onClick={() => useUi.getState().toggleSidebarView(v.id)}
      className={`relative flex size-9 items-center justify-center rounded ${
        active ? 'text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      <Icon icon={v.icon} className={iconSize.lg} />
      {v.id === 'git' && changes > 0 && (
        <span className="absolute right-0.5 bottom-0.5 rounded-full bg-accent px-1 text-[9px] leading-tight text-bg">
          {changes > 99 ? '99+' : changes}
        </span>
      )}
      {busy && !active && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />}
    </button>
  )
}

export function ActivityBar() {
  const changes = useWorkspace((s) => s.git?.entries.length ?? 0)
  const settingsHint = useShortcut('open-settings')
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel pt-2">
      {views.map((v) => (
        <ActivityButton key={v.id} view={v} changes={changes} />
      ))}
      <span className="flex-1" />
      <button
        title={`Settings (${settingsHint})`}
        data-testid="activity-settings"
        onClick={() => useEditor.getState().openSettings()}
        className="mb-2 flex size-9 items-center justify-center rounded text-muted hover:text-fg"
      >
        <Icon icon={Settings} className={iconSize.lg} />
      </button>
    </nav>
  )
}

export function Sidebar() {
  const current = useUi((s) => s.sidebar)
  const width = useUi((s) => s.layout.sidebarWidth)
  const open = useUi((s) => s.layout.sidebarOpen)
  return (
    <aside
      style={{ width }}
      className={`shrink-0 overflow-hidden border-r border-border bg-panel ${open ? '' : 'hidden'}`}
    >
      {/* Keep panels mounted so search state survives switching views and closing the sidebar. */}
      <div className={current === 'explorer' ? 'h-full' : 'hidden'}>
        <Explorer />
      </div>
      <div className={current === 'search' ? 'h-full' : 'hidden'}>
        <SearchPanel />
      </div>
      <div className={current === 'git' ? 'h-full' : 'hidden'}>
        <GitPanel />
      </div>
      <div className={current === 'commits' ? 'h-full' : 'hidden'}>
        <CommitsPanel />
      </div>
      <div className={current === 'pullRequests' ? 'h-full' : 'hidden'}>
        <PullRequestsPanel />
      </div>
      <div className={current === 'agents' ? 'h-full' : 'hidden'}>
        <AgentsSidebar />
      </div>
    </aside>
  )
}

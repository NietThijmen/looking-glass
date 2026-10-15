import { create } from 'zustand'
import type {
  DirEntry,
  FsChange,
  GitStatus,
  GitStatusEntry,
  PullRequestDetail,
  WorkspaceInfo,
} from '@lookingglass/shared/ipc'
import { ancestors, dirname } from '../lib/paths'

interface WorkspaceStore {
  info: WorkspaceInfo | null
  /** Loaded directory listings keyed by directory path ("" = root). */
  children: Record<string, DirEntry[]>
  expanded: Record<string, boolean>
  /** Workspace file paths for @pierre/trees (gitignore respected). */
  filePaths: string[] | null
  /** Explorer should scroll to this path once, then clear. */
  pendingTreeReveal: string | null
  git: GitStatus | null
  /** Git status by file path, plus a rolled-up marker for every ancestor dir. */
  gitByPath: Record<string, GitStatusEntry['status']>
  /** Open pull request for the current branch. Null is "no PR", including a missing GitHub token. */
  pullRequest: PullRequestDetail | null
  /** True while a branch change is resolving `git.pullRequest`. Typing does not wait on this. */
  pullRequestPending: boolean

  setWorkspace(info: WorkspaceInfo | null): Promise<void>
  loadDir(path: string): Promise<void>
  loadFilePaths(): Promise<void>
  toggleDir(path: string): void
  revealPath(path: string): void
  refreshGit(): Promise<void>
  refreshPullRequest(): Promise<void>
  applyFsChanges(changes: FsChange[]): void
}

function indexGit(git: GitStatus | null): Record<string, GitStatusEntry['status']> {
  const byPath: Record<string, GitStatusEntry['status']> = {}
  for (const entry of git?.entries ?? []) {
    byPath[entry.path] = entry.status
    for (const dir of ancestors(entry.path)) {
      if (dir) byPath[dir] ??= entry.status === 'deleted' ? 'modified' : entry.status
    }
  }
  return byPath
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  info: null,
  children: {},
  expanded: {},
  filePaths: null,
  pendingTreeReveal: null,
  git: null,
  gitByPath: {},
  pullRequest: null,
  pullRequestPending: false,

  async setWorkspace(info) {
    set({
      info,
      children: {},
      expanded: {},
      filePaths: null,
      pendingTreeReveal: null,
      git: null,
      gitByPath: {},
      pullRequest: null,
      pullRequestPending: false,
    })
    if (!info) return
    await Promise.all([get().loadFilePaths(), get().refreshGit()])
  },

  async loadFilePaths() {
    if (!get().info) return
    try {
      const paths = await window.lookingglass.fs.listFiles()
      set({ filePaths: paths })
    } catch {
      set({ filePaths: [] })
    }
  },

  async loadDir(path) {
    try {
      const entries = await window.lookingglass.fs.readDir(path)
      set((s) => ({ children: { ...s.children, [path]: entries } }))
    } catch {
      // Directory vanished: drop it and anything below it.
      set((s) => {
        const children = { ...s.children }
        for (const key of Object.keys(children)) {
          if (key === path || key.startsWith(path + '/')) delete children[key]
        }
        return { children }
      })
    }
  },

  toggleDir(path) {
    const open = !get().expanded[path]
    set((s) => ({ expanded: { ...s.expanded, [path]: open } }))
    if (open && !get().children[path]) void get().loadDir(path)
  },

  revealPath(path) {
    set({ pendingTreeReveal: path })
  },

  async refreshGit() {
    if (!get().info) return
    const previous = get().git?.branch ?? null
    const git = await window.lookingglass.git.status().catch(() => null)
    if (!git) {
      set({ git: null, gitByPath: {}, pullRequest: null, pullRequestPending: false })
      return
    }
    const branchChanged = git.branch !== previous
    set({
      git,
      gitByPath: indexGit(git),
      ...(branchChanged ? { pullRequest: null, pullRequestPending: git.branch !== null } : {}),
    })
    // Lookup stays off the status call. Refetch only when the branch changes.
    if (branchChanged) void get().refreshPullRequest()
  },

  async refreshPullRequest() {
    const branch = get().git?.branch
    if (!get().info || !branch) {
      set({ pullRequest: null, pullRequestPending: false })
      return
    }
    try {
      const pullRequest = await window.lookingglass.git.pullRequest()
      if (get().git?.branch !== branch) return
      set({ pullRequest, pullRequestPending: false })
    } catch {
      if (get().git?.branch !== branch) return
      set({ pullRequest: null, pullRequestPending: false })
    }
  },

  applyFsChanges(changes) {
    const { children } = get()
    const dirs = new Set<string>()
    for (const change of changes) {
      if (change.type === 'update') continue
      const parent = dirname(change.path)
      if (children[parent]) dirs.add(parent)
    }
    for (const dir of dirs) void get().loadDir(dir)
    void get().loadFilePaths()
  },
}))

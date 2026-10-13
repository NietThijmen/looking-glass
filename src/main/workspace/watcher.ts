import watcher, { type AsyncSubscription } from '@parcel/watcher'
import type { FsChange } from '../../shared/ipc'
import { toRelative } from './WorkspaceService'

export interface WatchHandlers {
  onFsChange(changes: FsChange[]): void
  /** Something that can affect `git status` changed (worktree or .git metadata). */
  onGitChange(): void
}

const FS_BATCH_MS = 75
const GIT_DEBOUNCE_MS = 300

// Churny paths nobody needs live updates for. node_modules still shows in the
// tree; it just won't refresh live.
const IGNORE = ['.git/objects', '.git/logs', 'node_modules', '.DS_Store']

export async function watchWorkspace(root: string, handlers: WatchHandlers): Promise<() => Promise<void>> {
  let pending = new Map<string, FsChange>()
  let fsTimer: NodeJS.Timeout | undefined
  let gitTimer: NodeJS.Timeout | undefined

  const flushFs = (): void => {
    fsTimer = undefined
    const changes = [...pending.values()]
    pending = new Map()
    if (changes.length) handlers.onFsChange(changes)
  }

  const subscription: AsyncSubscription = await watcher.subscribe(
    root,
    (error, events) => {
      if (error) {
        console.error('[watcher]', error)
        return
      }
      for (const event of events) {
        const rel = toRelative(root, event.path)
        if (rel === '.git' || rel.startsWith('.git/')) continue
        pending.set(rel, { path: rel, type: event.type })
      }
      if (pending.size && !fsTimer) fsTimer = setTimeout(flushFs, FS_BATCH_MS)
      // Any worktree or .git change (index, HEAD, refs) can change `git status`.
      if (events.length) {
        clearTimeout(gitTimer)
        gitTimer = setTimeout(handlers.onGitChange, GIT_DEBOUNCE_MS)
      }
    },
    { ignore: IGNORE },
  )

  return async () => {
    clearTimeout(fsTimer)
    clearTimeout(gitTimer)
    await subscription.unsubscribe()
  }
}

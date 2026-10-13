import type { GitStatusEntry as TreeGitEntry } from '@pierre/trees'
import type { GitFileStatus, GitStatusEntry } from '../../../shared/ipc'

const toTreeStatus: Record<GitFileStatus, TreeGitEntry['status']> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  untracked: 'untracked',
  conflicted: 'modified',
}

export function toTreeGitEntries(entries: readonly GitStatusEntry[]): TreeGitEntry[] {
  return entries.map((entry) => ({ path: entry.path, status: toTreeStatus[entry.status] }))
}

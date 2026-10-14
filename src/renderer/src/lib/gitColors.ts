import type { GitFileStatus } from '@lookingglass/shared/ipc'

export const gitColor: Record<GitFileStatus, string> = {
  modified: 'text-amber-300',
  added: 'text-emerald-400',
  untracked: 'text-emerald-400',
  renamed: 'text-sky-300',
  deleted: 'text-red-400',
  conflicted: 'text-fuchsia-400',
}

export const gitLetter: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  untracked: 'U',
  renamed: 'R',
  deleted: 'D',
  conflicted: '!',
}

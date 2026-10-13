import { useCallback, useEffect, useState } from 'react'
import type { GitLogEntry } from '../../../shared/ipc'
import { useWorkspace } from '../store/workspace'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function CommitRow({ entry }: { entry: GitLogEntry }) {
  return (
    <div
      data-testid="git-commit"
      data-hash={entry.shortHash}
      title={entry.hash}
      className="border-b border-border px-3 py-2 hover:bg-white/5"
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[11px] text-accent">{entry.shortHash}</span>
        <span className="min-w-0 truncate text-[13px] text-fg">{entry.subject}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted">
        {entry.author} · {formatWhen(entry.date)}
      </div>
    </div>
  )
}

export function CommitsPanel() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!info) return
    setLoading(true)
    try {
      const list = await window.lookingglass.git.log(80)
      setCommits(list)
    } finally {
      setLoading(false)
    }
  }, [info])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.lookingglass.git.onChanged(() => void load())
  }, [load])

  if (!info) return <div className="p-3 text-muted">No folder open.</div>
  if (!git) return <div className="p-3 text-muted">This folder isn't a git repository.</div>

  return (
    <div className="flex h-full flex-col" data-testid="commits-panel">
      <div className="flex items-center px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Commits
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto font-normal normal-case text-accent hover:underline disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-4">
        {loading && commits.length === 0 && <div className="px-3 text-muted">Loading…</div>}
        {!loading && commits.length === 0 && <div className="px-3 text-muted">No commits yet.</div>}
        {commits.map((entry) => (
          <CommitRow key={entry.hash} entry={entry} />
        ))}
      </div>
    </div>
  )
}

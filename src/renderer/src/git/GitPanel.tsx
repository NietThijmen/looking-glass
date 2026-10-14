import { useState } from 'react'
import type { GitStatusEntry } from '@lookingglass/shared/ipc'
import { gitColor, gitLetter } from '../lib/gitColors'
import { basename, dirname } from '../lib/paths'
import { useEditor } from '../store/editor'
import { useWorkspace } from '../store/workspace'
import { StatusDot } from '../ui/icon'
import { runCommit } from './commit'

function Entry({ entry }: { entry: GitStatusEntry }) {
  return (
    <div
      data-testid="git-entry"
      data-path={entry.path}
      title={entry.from ? `${entry.from} → ${entry.path}` : entry.path}
      onClick={() => void useEditor.getState().openDiff(entry.path)}
      className="flex h-[22px] cursor-default items-center gap-1.5 px-3 hover:bg-fg/5"
    >
      <span
        className={`truncate ${gitColor[entry.status]} ${entry.status === 'deleted' ? 'line-through' : ''}`}
      >
        {basename(entry.path)}
      </span>
      <span className="truncate text-[11px] text-muted">{dirname(entry.path)}</span>
      <span
        className={`ml-auto flex items-center gap-1 pl-2 font-mono text-[10px] ${gitColor[entry.status]}`}
      >
        {entry.staged ? <StatusDot /> : null}
        {gitLetter[entry.status]}
      </span>
    </div>
  )
}

export function GitPanel() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(pushAfter: boolean): Promise<void> {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await runCommit(message, pushAfter)
      setFeedback(result)
      if (result.ok) setMessage('')
    } finally {
      setBusy(false)
    }
  }

  if (!info) return <div className="p-3 text-muted">No folder open.</div>
  if (!git) return <div className="p-3 text-muted">This folder isn't a git repository.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Changes
        <span className="ml-auto font-normal normal-case">{git.branch ?? 'detached HEAD'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="git-panel">
        {git.entries.length === 0 && <div className="px-3 text-muted">No changes.</div>}
        {git.entries.map((entry) => (
          <Entry key={entry.path} entry={entry} />
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-3" data-testid="git-commit-form">
        <label className="mb-1 block text-[11px] text-muted">Commit message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="feat(scope): describe your change"
          className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[13px] outline-none select-text focus:border-accent disabled:opacity-50"
        />
        {feedback && (
          <p className={`mt-1.5 text-[11px] ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>
            {feedback.text}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="git-commit"
            disabled={busy || !message.trim()}
            onClick={() => void submit(false)}
            className="rounded border border-border px-3 py-1 text-[12px] hover:bg-fg/5 disabled:opacity-40"
          >
            Commit
          </button>
          <button
            type="button"
            data-testid="git-commit-push"
            disabled={busy || !message.trim()}
            onClick={() => void submit(true)}
            className="rounded bg-accent px-3 py-1 text-[12px] text-bg hover:opacity-90 disabled:opacity-40"
          >
            Commit &amp; push
          </button>
        </div>
      </div>
    </div>
  )
}

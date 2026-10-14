import { useState } from 'react'
import { useEditor } from '../store/editor'
import { useWorkspace } from '../store/workspace'
import { runCommit } from './commit'
import { suggestedCommitMessage, visibleHints } from './hints'

const chip = 'rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg'

/**
 * Commit, Commit & push, and View PR, in one row above the composer.
 * Commit does not run until the message field is confirmed.
 */
export function ComposerHints() {
  const git = useWorkspace((s) => s.git)
  const pullRequest = useWorkspace((s) => s.pullRequest)
  const hints = visibleHints({ dirty: !!git && git.entries.length > 0, pullRequest })
  const [draft, setDraft] = useState<{ push: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  if (!hints.commit && !hints.viewPr && !draft) return null

  const open = (push: boolean): void => {
    const paths = useWorkspace.getState().git?.entries.map((entry) => entry.path) ?? []
    setFeedback(null)
    setDraft({ push, message: suggestedCommitMessage(paths) })
  }

  const submit = async (): Promise<void> => {
    if (!draft || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await runCommit(draft.message, draft.push)
      setFeedback(result)
      if (result.ok) setDraft(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-1.5" data-testid="composer-hints">
      <div className="flex flex-wrap items-center gap-1">
        {draft ? (
          <input
            data-testid="composer-commit-message"
            data-push={draft.push}
            aria-label={draft.push ? 'Commit and push message' : 'Commit message'}
            value={draft.message}
            disabled={busy}
            autoFocus
            onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(null)
                setFeedback(null)
              }
            }}
            className="min-w-40 flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] outline-none focus:border-accent disabled:opacity-50"
          />
        ) : (
          <>
            {hints.commit && (
              <button
                type="button"
                data-testid="composer-commit"
                onClick={() => open(false)}
                className={chip}
              >
                Commit
              </button>
            )}
            {hints.commitAndPush && (
              <button
                type="button"
                data-testid="composer-commit-push"
                onClick={() => open(true)}
                className={chip}
              >
                Commit &amp; push
              </button>
            )}
          </>
        )}
        {hints.viewPr && (
          <button
            type="button"
            data-testid="composer-view-pr"
            onClick={() => useEditor.getState().openPullRequest()}
            className={chip}
          >
            View PR
          </button>
        )}
      </div>
      {feedback && (
        <p
          data-testid="composer-commit-feedback"
          className={`mt-1 text-[11px] ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  )
}

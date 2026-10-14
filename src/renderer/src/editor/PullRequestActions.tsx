import type { PullRequestAction, PullRequestDetail, PullRequestMergeMethod } from '@lookingglass/shared/forge'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { Chevron } from '../ui/icon'

const buttonClass =
  'rounded border border-border px-3 py-1 text-[12px] hover:bg-fg/5 disabled:opacity-40 disabled:hover:bg-transparent'
const primaryClass = 'rounded bg-accent px-3 py-1 text-[12px] text-bg hover:opacity-90 disabled:opacity-40'
const textareaClass =
  'w-full resize-y rounded border border-border bg-bg px-2 py-1.5 text-[13px] outline-none select-text focus:border-accent disabled:opacity-50'

/** Runs one forge action on `pr`, then refetches so the tab shows what the forge now has. */
function usePullRequestAction(pr: PullRequestDetail) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: PullRequestAction): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.lookingglass.git.pullRequestAction(pr.number, action)
      if (!result.ok) {
        setError(result.error ?? 'The forge rejected the change.')
        return false
      }
      await useWorkspace.getState().refreshPullRequest()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, run }
}

function ActionError({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mt-1.5 text-[11px] break-words text-red-400">{error}</p>
}

const mergeLabel: Record<PullRequestMergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
}

const mergeHint: Record<PullRequestMergeMethod, string> = {
  merge: 'All commits are added to the base branch via a merge commit.',
  squash: 'All commits are combined into one commit on the base branch.',
  rebase: 'All commits are rebased onto the base branch.',
}

/** Draft toggle and the merge button with its commit options, top right of the header. */
export function PullRequestHeaderActions({ pr }: { pr: PullRequestDetail }) {
  const { busy, error, run } = usePullRequestAction(pr)
  const [method, setMethod] = useState<PullRequestMergeMethod>('merge')
  const [menuOpen, setMenuOpen] = useState(false)
  // Merging can't be undone from here, so the first click only arms it.
  const [confirming, setConfirming] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className="flex items-center gap-2">
        {pr.isDraft ? (
          <button
            type="button"
            data-testid="pr-ready"
            disabled={busy}
            onClick={() => void run({ kind: 'ready' })}
            className={buttonClass}
          >
            Ready for review
          </button>
        ) : (
          <button
            type="button"
            data-testid="pr-draft"
            disabled={busy}
            onClick={() => void run({ kind: 'draft' })}
            className={buttonClass}
          >
            Mark as draft
          </button>
        )}
        <div ref={menuRef} className="relative flex">
          <button
            type="button"
            data-testid="pr-merge"
            data-method={method}
            disabled={busy || pr.isDraft}
            title={pr.isDraft ? 'Draft pull requests cannot be merged.' : mergeHint[method]}
            onBlur={() => setConfirming(false)}
            onClick={() => {
              if (!confirming) return setConfirming(true)
              setConfirming(false)
              void run({ kind: 'merge', method })
            }}
            className={`${primaryClass} rounded-r-none`}
          >
            {confirming ? `Confirm ${mergeLabel[method].toLowerCase()}` : mergeLabel[method]}
          </button>
          <button
            type="button"
            data-testid="pr-merge-options"
            aria-label="Merge options"
            aria-expanded={menuOpen}
            disabled={busy || pr.isDraft}
            onClick={() => setMenuOpen((open) => !open)}
            className={`${primaryClass} rounded-l-none border-l border-bg/30 px-1.5`}
          >
            <Chevron open={menuOpen} />
          </button>
          {menuOpen && (
            <ul
              role="menu"
              className="absolute top-full right-0 z-10 mt-1 w-72 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg"
            >
              {(Object.keys(mergeLabel) as PullRequestMergeMethod[]).map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={option === method}
                    data-testid="pr-merge-option"
                    data-method={option}
                    onClick={() => {
                      setMethod(option)
                      setConfirming(false)
                      setMenuOpen(false)
                    }}
                    className={`block w-full px-3 py-1.5 text-left hover:bg-fg/5 ${option === method ? 'bg-fg/5' : ''}`}
                  >
                    <div className="text-[12px] text-fg">{mergeLabel[option]}</div>
                    <div className="text-[11px] text-muted">{mergeHint[option]}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ActionError error={error} />
    </div>
  )
}

/** Textarea that replaces the description card while editing. */
export function DescriptionEditor({ pr, onDone }: { pr: PullRequestDetail; onDone(): void }) {
  const { busy, error, run } = usePullRequestAction(pr)
  const [body, setBody] = useState(pr.body)

  return (
    <div data-testid="pr-description-editor">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
        rows={12}
        className={`${textareaClass} font-mono`}
      />
      <ActionError error={error} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onDone} className={buttonClass}>
          Cancel
        </button>
        <button
          type="button"
          data-testid="pr-description-save"
          disabled={busy || body === pr.body}
          onClick={() => void run({ kind: 'editBody', body }).then((ok) => ok && onDone())}
          className={primaryClass}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** New comment box under the conversation. */
export function CommentComposer({ pr }: { pr: PullRequestDetail }) {
  const { busy, error, run } = usePullRequestAction(pr)
  const [body, setBody] = useState('')

  async function submit(): Promise<void> {
    if (await run({ kind: 'comment', body })) setBody('')
  }

  return (
    <div className="mt-3" data-testid="pr-comment-form">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault()
            void submit()
          }
        }}
        disabled={busy}
        rows={4}
        placeholder="Leave a comment (Markdown)"
        className={textareaClass}
      />
      <ActionError error={error} />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          data-testid="pr-comment-submit"
          disabled={busy || !body.trim()}
          onClick={() => void submit()}
          className={primaryClass}
        >
          {busy ? 'Commenting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}

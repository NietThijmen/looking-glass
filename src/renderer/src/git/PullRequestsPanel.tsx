import { useCallback, useEffect, useState } from 'react'
import {
  pullRequestBranch,
  type PullRequestListResult,
  type PullRequestSummary,
} from '@lookingglass/shared/forge'
import { useWorkspace } from '../store/workspace'
import {
  checkoutPullRequest,
  fixPullRequestCi,
  reviewPullRequest,
  viewPullRequest,
} from './pullRequestReview'

const actions = {
  checkout: checkoutPullRequest,
  review: reviewPullRequest,
  fixCi: fixPullRequestCi,
  view: viewPullRequest,
}

type Busy = { number: number; action: 'checkout' | 'review' | 'fixCi' | 'view' }

function PullRequestRow({
  pr,
  current,
  busy,
  disabled,
  onCheckout,
  onReview,
  onFixCi,
  onView,
}: {
  pr: PullRequestSummary
  current: boolean
  busy: Busy['action'] | null
  disabled: boolean
  onCheckout(): void
  onReview(): void
  onFixCi(): void
  onView(): void
}) {
  return (
    <div data-testid="pull-request-row" data-number={pr.number} className="border-b border-border px-3 py-2">
      <button
        type="button"
        data-testid="pull-request-open"
        disabled={disabled}
        onClick={onView}
        className="block w-full text-left disabled:opacity-50"
      >
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[11px] text-muted">#{pr.number}</span>
          <span className="min-w-0 truncate text-[13px] text-fg" title={pr.title}>
            {pr.title}
          </span>
          {pr.isDraft && (
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted">
              Draft
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {pr.author} · {pr.head} into {pr.base}
        </div>
      </button>
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          data-testid="pull-request-checkout"
          disabled={disabled || current}
          onClick={onCheckout}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-fg/5 disabled:opacity-50"
        >
          {busy === 'checkout' ? 'Checking out…' : current ? 'Checked out' : 'Checkout'}
        </button>
        <button
          type="button"
          data-testid="pull-request-review"
          disabled={disabled}
          onClick={onReview}
          className="rounded bg-accent px-2 py-0.5 text-[11px] text-bg hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'review' ? 'Starting…' : 'Review'}
        </button>
        {pr.ciFailing && (
          <button
            type="button"
            data-testid="pull-request-fix-ci"
            disabled={disabled}
            onClick={onFixCi}
            className="rounded border border-red-400 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-400/10 disabled:opacity-50"
          >
            {busy === 'fixCi' ? 'Starting…' : 'Fix CI'}
          </button>
        )}
      </div>
    </div>
  )
}

export function PullRequestsPanel() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)
  const branch = git?.branch ?? null
  /** null until the first load finishes. */
  const [list, setList] = useState<PullRequestListResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      window.lookingglass.git.pullRequests().then(
        (result) => setList(result),
        (error: unknown) =>
          setList({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ),
    [],
  )

  const refresh = (): void => {
    setRefreshing(true)
    void load().finally(() => setRefreshing(false))
  }

  // Each load is a GitHub request, so reload on a new folder or branch, not on every git change.
  const isRepo = Boolean(info && git)
  useEffect(() => {
    if (isRepo) void load()
  }, [isRepo, branch, load])

  const run = async (pr: PullRequestSummary, action: Busy['action']): Promise<void> => {
    setBusy({ number: pr.number, action })
    setError(null)
    const failure = await actions[action](pr)
    if (failure) setError(failure)
    setBusy(null)
  }

  if (!info) return <div className="p-3 text-muted">No folder open.</div>
  if (!git) return <div className="p-3 text-muted">This folder isn't a git repository.</div>

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pull-requests-panel">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-1.5 text-[11px] text-muted uppercase">
        Pull Requests
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="ml-auto normal-case hover:text-fg disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && (
        <div
          data-testid="pull-request-error"
          className="shrink-0 px-3 py-2 text-[12px] text-red-400 select-text"
        >
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list === null ? (
          <div className="p-3 text-muted">Loading pull requests…</div>
        ) : !list.ok ? (
          <div className="p-3 text-red-400 select-text">{list.error}</div>
        ) : list.pullRequests.length === 0 ? (
          <div className="p-3 text-muted">No open pull requests.</div>
        ) : (
          list.pullRequests.map((pr) => (
            <PullRequestRow
              key={pr.number}
              pr={pr}
              current={branch === pullRequestBranch(pr)}
              busy={busy?.number === pr.number ? busy.action : null}
              disabled={busy !== null}
              onCheckout={() => void run(pr, 'checkout')}
              onReview={() => void run(pr, 'review')}
              onFixCi={() => void run(pr, 'fixCi')}
              onView={() => void run(pr, 'view')}
            />
          ))
        )}
      </div>
    </div>
  )
}

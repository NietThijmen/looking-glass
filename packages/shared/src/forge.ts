/**
 * Pull request detail shared by the pull-request tab and `@ci`.
 * GitHub is the only forge that fills this in today.
 */

export type PullRequestFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface PullRequestFile {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
  /** Unified diff for this file, or empty when the forge sent no patch. */
  patch: string
}

/** `conclusion` is null while the check has not finished. */
export interface PullRequestCheck {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'unknown'
  conclusion: string | null
  url: string
}

/** A conversation comment, or a review submitted with a body. */
export interface PullRequestComment {
  author: string
  body: string
  /** ISO timestamp; empty when the forge sent none. */
  createdAt: string
  /** Review verdict such as approved or changes_requested; null for a plain comment. */
  review: string | null
}

export interface PullRequestDetail {
  forgeId: string
  number: number
  title: string
  body: string
  url: string
  author: string
  base: string
  head: string
  isDraft: boolean
  files: PullRequestFile[]
  checks: PullRequestCheck[]
  /** Oldest first. */
  comments: PullRequestComment[]
}

/** One row of the pull-request list. */
export interface PullRequestSummary {
  number: number
  title: string
  author: string
  base: string
  head: string
  isDraft: boolean
  url: string
  /** The head branch lives in another repository, so it is not on the remote as `head`. */
  fromFork: boolean
}

/** Open pull requests, or why they could not be listed. */
export type PullRequestListResult =
  { ok: true; pullRequests: PullRequestSummary[] } | { ok: false; error: string }

/** The local branch checking out a pull request leaves you on. */
export function pullRequestBranch(pr: Pick<PullRequestSummary, 'number' | 'head' | 'fromFork'>): string {
  return pr.fromFork ? `pr-${pr.number}` : pr.head
}

export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase'

/** A change the pull-request tab asks the forge to make. */
export type PullRequestAction =
  | { kind: 'editBody'; body: string }
  | { kind: 'comment'; body: string }
  | { kind: 'draft' }
  | { kind: 'ready' }
  | { kind: 'merge'; method: PullRequestMergeMethod }

export interface PullRequestActionResult {
  ok: boolean
  error?: string
}

/** Word shown for a check: its conclusion, or pending when it has none yet. */
export function checkLabel(check: PullRequestCheck): string {
  const conclusion = check.conclusion?.trim().toLowerCase()
  return conclusion ? conclusion : 'pending'
}

/** Text block `@ci` attaches. An empty rollup says so instead of inventing a log. */
export function formatCi(pr: { number: number; title: string; checks: PullRequestCheck[] }): string {
  const lines = pr.checks.map((check) => `- ${check.name}: ${checkLabel(check)}`)
  return `CI for PR #${pr.number} ${pr.title}:\n${lines.length ? lines.join('\n') : 'No checks.'}`
}

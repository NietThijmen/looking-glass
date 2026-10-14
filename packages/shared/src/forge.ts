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

export interface PullRequestDetail {
  forgeId: string
  number: number
  title: string
  body: string
  url: string
  author: string
  base: string
  head: string
  files: PullRequestFile[]
  checks: PullRequestCheck[]
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

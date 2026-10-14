import type {
  PullRequestAction,
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
} from '@lookingglass/shared/forge'
import { splitDiff, type SplitPatch } from './diff'
import type { Forge, PullRequestQuery } from './types'

const GITHUB_ID = 'github'

const VIEW_FIELDS =
  'number,title,body,url,author,baseRefName,headRefName,state,isDraft,files,statusCheckRollup,comments,reviews'

interface ListedFile {
  path: string
  additions: number
  deletions: number
}

/** GitHub.com only. A missing `gh`, a missing login, or no open pull request is null. */
export const GithubForge: Forge = {
  id: GITHUB_ID,
  matches(remote) {
    return remote.host === 'github.com'
  },
  async pullRequest(query) {
    try {
      return await loadPullRequest(query)
    } catch {
      return null
    }
  },
  async act(query, number, action) {
    const repo = `${query.remote.owner}/${query.remote.repo}`
    try {
      const result = await query.run('gh', [...actionArgs(number, action), '--repo', repo], query.cwd)
      if (result.code === 0) return { ok: true }
      return { ok: false, error: result.stderr.trim() || `gh exited with code ${result.code}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}

/** `gh pr` arguments for one action, minus `--repo`. Bodies go as arguments; there is no shell. */
export function actionArgs(number: number, action: PullRequestAction): string[] {
  const pr = String(number)
  switch (action.kind) {
    case 'editBody':
      return ['pr', 'edit', pr, '--body', action.body]
    case 'comment':
      return ['pr', 'comment', pr, '--body', action.body]
    case 'draft':
      return ['pr', 'ready', pr, '--undo']
    case 'ready':
      return ['pr', 'ready', pr]
    case 'merge':
      return ['pr', 'merge', pr, `--${action.method}`]
  }
}

async function loadPullRequest(query: PullRequestQuery): Promise<PullRequestDetail | null> {
  const repo = `${query.remote.owner}/${query.remote.repo}`
  const view = await query.run(
    'gh',
    ['pr', 'view', query.branch, '--repo', repo, '--json', VIEW_FIELDS],
    query.cwd,
  )
  if (view.code !== 0) return null

  const json = parseView(view.stdout)
  if (!json) return null

  const diff = await query.run('gh', ['pr', 'diff', String(json.number), '--repo', repo], query.cwd)
  const patches = diff.code === 0 ? splitDiff(diff.stdout) : new Map<string, SplitPatch>()

  return {
    forgeId: GITHUB_ID,
    number: json.number,
    title: asString(json.title),
    body: asString(json.body),
    url: asString(json.url),
    author: authorLogin(json.author),
    base: asString(json.baseRefName),
    head: asString(json.headRefName),
    isDraft: json.isDraft === true,
    files: buildFiles(asFiles(json.files), patches),
    checks: asChecks(json.statusCheckRollup),
    comments: asComments(json.comments, json.reviews),
  }
}

interface GhView {
  number: number
  title: unknown
  body: unknown
  url: unknown
  author: unknown
  baseRefName: unknown
  headRefName: unknown
  isDraft: unknown
  files: unknown
  statusCheckRollup: unknown
  comments: unknown
  reviews: unknown
}

function parseView(stdout: string): GhView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const json = parsed as Record<string, unknown>
  if (typeof json.number !== 'number') return null
  if (typeof json.state !== 'string' || json.state.toUpperCase() !== 'OPEN') return null
  return {
    number: json.number,
    title: json.title,
    body: json.body,
    url: json.url,
    author: json.author,
    baseRefName: json.baseRefName,
    headRefName: json.headRefName,
    isDraft: json.isDraft,
    files: json.files,
    statusCheckRollup: json.statusCheckRollup,
    comments: json.comments,
    reviews: json.reviews,
  }
}

function buildFiles(listed: ListedFile[], patches: Map<string, SplitPatch>): PullRequestFile[] {
  const used = new Set<string>()
  const files: PullRequestFile[] = []
  for (const file of listed) {
    const patch = patches.get(file.path)
    if (patch) used.add(file.path)
    files.push({
      path: file.path,
      status: patch?.status ?? 'modified',
      additions: file.additions,
      deletions: file.deletions,
      patch: patch?.patch ?? '',
    })
  }
  for (const [path, patch] of patches) {
    if (used.has(path)) continue
    files.push({
      path,
      status: patch.status,
      additions: patch.additions,
      deletions: patch.deletions,
      patch: patch.patch,
    })
  }
  return files
}

function asFiles(value: unknown): ListedFile[] {
  if (!Array.isArray(value)) return []
  const files: ListedFile[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const file = item as { path?: unknown; additions?: unknown; deletions?: unknown }
    if (typeof file.path !== 'string') continue
    files.push({
      path: file.path,
      additions: typeof file.additions === 'number' ? file.additions : 0,
      deletions: typeof file.deletions === 'number' ? file.deletions : 0,
    })
  }
  return files
}

function asChecks(value: unknown): PullRequestCheck[] {
  if (!Array.isArray(value)) return []
  const checks: PullRequestCheck[] = []
  for (const item of value) {
    const check = asCheck(item)
    if (check) checks.push(check)
  }
  return checks
}

function asCheck(item: unknown): PullRequestCheck | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const typename = typeof raw.__typename === 'string' ? raw.__typename : ''
  if (typename === 'StatusContext' || (typeof raw.context === 'string' && typeof raw.name !== 'string')) {
    return statusContext(raw)
  }
  if (typeof raw.name !== 'string' || !raw.name) return null
  return {
    name: raw.name,
    status: mapRunStatus(typeof raw.status === 'string' ? raw.status : undefined),
    conclusion: mapConclusion(raw.conclusion),
    url: typeof raw.detailsUrl === 'string' ? raw.detailsUrl : '',
  }
}

function statusContext(raw: Record<string, unknown>): PullRequestCheck {
  const state = typeof raw.state === 'string' ? raw.state.toUpperCase() : ''
  const conclusion =
    state === 'SUCCESS' ? 'success' : state === 'FAILURE' || state === 'ERROR' ? 'failure' : null
  const status: PullRequestCheck['status'] = conclusion
    ? 'completed'
    : state === 'PENDING' || state === 'EXPECTED'
      ? 'queued'
      : 'unknown'
  return {
    name: typeof raw.context === 'string' && raw.context ? raw.context : 'status',
    status,
    conclusion,
    url: typeof raw.targetUrl === 'string' ? raw.targetUrl : '',
  }
}

function mapRunStatus(status: string | undefined): PullRequestCheck['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'QUEUED':
    case 'PENDING':
    case 'WAITING':
    case 'REQUESTED':
      return 'queued'
    case 'IN_PROGRESS':
      return 'in_progress'
    case 'COMPLETED':
      return 'completed'
    default:
      return 'unknown'
  }
}

function mapConclusion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed ? trimmed : null
}

/** Comments and reviews merged by time. A review with no body and no verdict worth showing is dropped. */
function asComments(comments: unknown, reviews: unknown): PullRequestComment[] {
  const merged: PullRequestComment[] = []
  for (const item of Array.isArray(comments) ? comments : []) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    merged.push({
      author: authorLogin(raw.author),
      body: asString(raw.body),
      createdAt: asString(raw.createdAt),
      review: null,
    })
  }
  for (const item of Array.isArray(reviews) ? reviews : []) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const state = asString(raw.state).toLowerCase()
    const body = asString(raw.body)
    if (!body.trim() && (state === 'commented' || state === 'pending' || !state)) continue
    merged.push({
      author: authorLogin(raw.author),
      body,
      createdAt: asString(raw.submittedAt),
      review: state || null,
    })
  }
  // ISO timestamps sort as strings; the sort is stable so undated entries keep their order.
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

function authorLogin(author: unknown): string {
  if (typeof author === 'string' && author) return author
  if (author && typeof author === 'object' && 'login' in author) {
    const login = (author as { login?: unknown }).login
    if (typeof login === 'string' && login) return login
  }
  return 'unknown'
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

import type {
  PullRequestAction,
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  PullRequestSummary,
} from '@lookingglass/shared/forge'
import { splitDiff, type SplitPatch } from './diff'
import type { Forge, PullRequestQuery } from './types'

const GITHUB_ID = 'github'
const API = 'https://api.github.com'
const PER_PAGE = 100
const MAX_PAGES = 10

interface ListedFile {
  path: string
  additions: number
  deletions: number
}

type PullFields = Omit<PullRequestSummary, 'fromFork' | 'ciFailing'>

interface Pull {
  fields: PullFields
  fromFork: boolean
  body: string
  headSha: string
}

/** GitHub.com only. A missing token, a failed request, or no open pull request is null. */
export const GithubForge: Forge = {
  id: GITHUB_ID,
  matches(remote) {
    return remote.host === 'github.com'
  },
  async list(query) {
    try {
      const open = await getPages(query, `${repoUrl(query)}/pulls?state=open&sort=created&direction=desc`)
      const pulls = open.flatMap((item) => parsePull(item) ?? [])
      const pullRequests = await Promise.all(
        pulls.map(async (pull) => ({
          ...pull.fields,
          fromFork: pull.fromFork,
          ciFailing: (await loadChecks(query, pull.headSha)).some(isFailing),
        })),
      )
      return { ok: true, pullRequests }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  },
  async pullRequest(query) {
    try {
      return await loadPullRequest(query)
    } catch {
      return null
    }
  },
  async act(query, number, action) {
    try {
      await runAction(query, number, action)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  },
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function repoUrl(query: PullRequestQuery): string {
  return `${API}/repos/${encodeURIComponent(query.remote.owner)}/${encodeURIComponent(query.remote.repo)}`
}

async function request(
  query: PullRequestQuery,
  method: string,
  url: string,
  options: { body?: unknown; accept?: string } = {},
): Promise<Response> {
  if (!query.token) throw new Error('No GitHub token. Run `gh auth login` or set GH_TOKEN.')
  const response = await query.fetch(url, {
    method,
    headers: {
      Accept: options.accept ?? 'application/vnd.github+json',
      Authorization: `Bearer ${query.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const message = (JSON.parse(text) as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON; fall through to the status line.
  }
  return text.trim() || `GitHub returned ${response.status}`
}

async function getJson(query: PullRequestQuery, url: string): Promise<unknown> {
  return (await request(query, 'GET', url)).json()
}

/**
 * Every page of a list endpoint, capped so a huge pull request cannot loop forever.
 * `select` picks the array out of a response that wraps it.
 */
async function getPages(
  query: PullRequestQuery,
  url: string,
  select: (json: unknown) => unknown = (json) => json,
): Promise<unknown[]> {
  const items: unknown[] = []
  const joiner = url.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = select(await getJson(query, `${url}${joiner}per_page=${PER_PAGE}&page=${page}`))
    if (!Array.isArray(list)) break
    items.push(...list)
    if (list.length < PER_PAGE) break
  }
  return items
}

async function runAction(query: PullRequestQuery, number: number, action: PullRequestAction): Promise<void> {
  const pullUrl = `${repoUrl(query)}/pulls/${number}`
  switch (action.kind) {
    case 'editBody':
      await request(query, 'PATCH', pullUrl, { body: { body: action.body } })
      break
    case 'comment':
      await request(query, 'POST', `${repoUrl(query)}/issues/${number}/comments`, {
        body: { body: action.body },
      })
      break
    case 'draft':
    case 'ready': {
      // The REST API cannot toggle draft state; only GraphQL can.
      const nodeId = asString(asRecord(await getJson(query, pullUrl)).node_id)
      if (!nodeId) throw new Error('GitHub did not return the pull request id.')
      const mutation = action.kind === 'draft' ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
      const response = await request(query, 'POST', `${API}/graphql`, {
        body: {
          query: `mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { clientMutationId } }`,
          variables: { id: nodeId },
        },
      })
      const errors = asRecord(await response.json()).errors
      if (Array.isArray(errors) && errors.length > 0) {
        throw new Error(asString(asRecord(errors[0]).message) || 'GitHub rejected the request.')
      }
      break
    }
    case 'merge':
      await request(query, 'PUT', `${pullUrl}/merge`, { body: { merge_method: action.method } })
      break
  }
}

async function loadPullRequest(query: PullRequestQuery): Promise<PullRequestDetail | null> {
  const repo = repoUrl(query)
  const head = encodeURIComponent(`${query.remote.owner}:${query.branch}`)
  const open = await getJson(query, `${repo}/pulls?state=open&head=${head}&per_page=1`)
  const pull = Array.isArray(open) ? parsePull(open[0]) : null
  if (!pull) return null
  const { number } = pull.fields

  const [files, diff, checks, comments, reviews] = await Promise.all([
    getPages(query, `${repo}/pulls/${number}/files`).catch(() => []),
    request(query, 'GET', `${repo}/pulls/${number}`, { accept: 'application/vnd.github.v3.diff' })
      .then((response) => response.text())
      .catch(() => ''),
    loadChecks(query, pull.headSha),
    getPages(query, `${repo}/issues/${number}/comments`).catch(() => []),
    getPages(query, `${repo}/pulls/${number}/reviews`).catch(() => []),
  ])
  const patches = diff ? splitDiff(diff) : new Map<string, SplitPatch>()

  return {
    forgeId: GITHUB_ID,
    ...pull.fields,
    body: pull.body,
    files: buildFiles(asFiles(files), patches),
    checks,
    comments: mergeComments([
      ...comments.map(issueComment),
      ...reviews.flatMap((review) => reviewComment(review) ?? []),
    ]),
  }
}

/** Check runs and commit statuses for a commit. A failed request counts as no checks. */
async function loadChecks(query: PullRequestQuery, sha: string): Promise<PullRequestCheck[]> {
  const commit = `${repoUrl(query)}/commits/${sha}`
  const [runs, statuses] = await Promise.all([
    getPages(query, `${commit}/check-runs`, (json) => asRecord(json).check_runs).catch(() => []),
    getJson(query, `${commit}/status`).catch(() => null),
  ])
  const contexts = asRecord(statuses).statuses
  return [
    ...runs.flatMap((run) => runCheck(run) ?? []),
    ...(Array.isArray(contexts) ? contexts.map(statusCheck) : []),
  ]
}

function isFailing(check: PullRequestCheck): boolean {
  return check.conclusion === 'failure' || check.conclusion === 'timed_out'
}

function parsePull(value: unknown): Pull | null {
  const raw = asRecord(value)
  if (typeof raw.number !== 'number') return null
  if (asString(raw.state).toLowerCase() !== 'open') return null
  const head = asRecord(raw.head)
  const base = asRecord(raw.base)
  return {
    fields: {
      number: raw.number,
      title: asString(raw.title),
      author: authorLogin(raw.user),
      base: asString(base.ref),
      head: asString(head.ref),
      isDraft: raw.draft === true,
      url: asString(raw.html_url),
    },
    fromFork: asString(asRecord(head.repo).full_name) !== asString(asRecord(base.repo).full_name),
    body: asString(raw.body),
    headSha: asString(head.sha),
  }
}

function runCheck(item: unknown): PullRequestCheck | null {
  const raw = asRecord(item)
  const name = asString(raw.name)
  if (!name) return null
  return {
    name,
    status: mapRunStatus(asString(raw.status)),
    conclusion: mapConclusion(raw.conclusion),
    url: asString(raw.html_url),
  }
}

function statusCheck(item: unknown): PullRequestCheck {
  const raw = asRecord(item)
  const state = asString(raw.state).toUpperCase()
  const conclusion =
    state === 'SUCCESS' ? 'success' : state === 'FAILURE' || state === 'ERROR' ? 'failure' : null
  const status: PullRequestCheck['status'] = conclusion
    ? 'completed'
    : state === 'PENDING' || state === 'EXPECTED'
      ? 'queued'
      : 'unknown'
  return { name: asString(raw.context) || 'status', status, conclusion, url: asString(raw.target_url) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
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
    const file = item as { filename?: unknown; additions?: unknown; deletions?: unknown }
    if (typeof file.filename !== 'string') continue
    files.push({
      path: file.filename,
      additions: typeof file.additions === 'number' ? file.additions : 0,
      deletions: typeof file.deletions === 'number' ? file.deletions : 0,
    })
  }
  return files
}

function mapRunStatus(status: string): PullRequestCheck['status'] {
  switch (status.toUpperCase()) {
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

function issueComment(item: unknown): PullRequestComment {
  const raw = asRecord(item)
  return {
    author: authorLogin(raw.user),
    body: asString(raw.body),
    createdAt: asString(raw.created_at),
    review: null,
  }
}

/** A review with no body and no verdict worth showing is dropped. */
function reviewComment(item: unknown): PullRequestComment | null {
  const raw = asRecord(item)
  const state = asString(raw.state).toLowerCase()
  const body = asString(raw.body)
  if (!body.trim() && (state === 'commented' || state === 'pending' || !state)) return null
  return {
    author: authorLogin(raw.user),
    body,
    createdAt: asString(raw.submitted_at),
    review: state || null,
  }
}

/** Oldest first. ISO timestamps sort as strings; the sort is stable so undated entries keep their order. */
function mergeComments(comments: PullRequestComment[]): PullRequestComment[] {
  return comments.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
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

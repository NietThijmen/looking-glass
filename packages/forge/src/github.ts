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
const API = 'https://api.github.com'
const PER_PAGE = 100
const MAX_PAGES = 10

interface ListedFile {
  path: string
  additions: number
  deletions: number
}

interface Pull {
  number: number
  nodeId: string
  title: unknown
  body: unknown
  url: unknown
  author: unknown
  base: unknown
  head: unknown
  headSha: string
  isDraft: unknown
}

/** GitHub.com only. A missing token, a failed request, or no open pull request is null. */
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
    try {
      return await runAction(query, number, action)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}

class GithubError extends Error {}

function repoPath(query: PullRequestQuery): string {
  return `/repos/${encodeURIComponent(query.remote.owner)}/${encodeURIComponent(query.remote.repo)}`
}

async function request(
  query: PullRequestQuery,
  method: string,
  path: string,
  options: { body?: unknown; accept?: string } = {},
): Promise<Response> {
  if (!query.token) throw new GithubError('No GitHub token. Set GH_TOKEN or GITHUB_TOKEN.')
  const response = await query.fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Accept: options.accept ?? 'application/vnd.github+json',
      Authorization: `Bearer ${query.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (!response.ok) throw new GithubError(await errorMessage(response))
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

async function getJson(query: PullRequestQuery, path: string): Promise<unknown> {
  return (await request(query, 'GET', path)).json()
}

/** Every page of a list endpoint, capped so a huge pull request cannot loop forever. */
async function getPages(query: PullRequestQuery, path: string, key?: string): Promise<unknown[]> {
  const items: unknown[] = []
  const joiner = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await getJson(query, `${path}${joiner}per_page=${PER_PAGE}&page=${page}`)
    const list = key && json && typeof json === 'object' ? (json as Record<string, unknown>)[key] : json
    if (!Array.isArray(list)) break
    items.push(...list)
    if (list.length < PER_PAGE) break
  }
  return items
}

async function runAction(
  query: PullRequestQuery,
  number: number,
  action: PullRequestAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const repo = repoPath(query)
  switch (action.kind) {
    case 'editBody':
      await request(query, 'PATCH', `${repo}/pulls/${number}`, { body: { body: action.body } })
      break
    case 'comment':
      await request(query, 'POST', `${repo}/issues/${number}/comments`, { body: { body: action.body } })
      break
    case 'draft':
    case 'ready': {
      // The REST API cannot toggle draft state; only GraphQL can.
      const pull = asRecord(await getJson(query, `${repo}/pulls/${number}`))
      const nodeId = asString(pull.node_id)
      if (!nodeId) throw new GithubError('GitHub did not return the pull request id.')
      const mutation = action.kind === 'draft' ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
      const response = await request(query, 'POST', `${API}/graphql`, {
        body: {
          query: `mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { clientMutationId } }`,
          variables: { id: nodeId },
        },
      })
      const errors = asRecord(await response.json()).errors
      if (Array.isArray(errors) && errors.length > 0) {
        throw new GithubError(asString(asRecord(errors[0]).message) || 'GitHub rejected the request.')
      }
      break
    }
    case 'merge':
      await request(query, 'PUT', `${repo}/pulls/${number}/merge`, { body: { merge_method: action.method } })
      break
  }
  return { ok: true }
}

async function loadPullRequest(query: PullRequestQuery): Promise<PullRequestDetail | null> {
  const repo = repoPath(query)
  const head = encodeURIComponent(`${query.remote.owner}:${query.branch}`)
  const open = await getJson(query, `${repo}/pulls?state=open&head=${head}&per_page=1`)
  const pull = Array.isArray(open) ? parsePull(open[0]) : null
  if (!pull) return null

  const [files, diff, runs, statuses, comments, reviews] = await Promise.all([
    getPages(query, `${repo}/pulls/${pull.number}/files`).catch(() => []),
    request(query, 'GET', `${repo}/pulls/${pull.number}`, { accept: 'application/vnd.github.v3.diff' })
      .then((response) => response.text())
      .catch(() => ''),
    getPages(query, `${repo}/commits/${pull.headSha}/check-runs`, 'check_runs').catch(() => []),
    getJson(query, `${repo}/commits/${pull.headSha}/status`).catch(() => null),
    getPages(query, `${repo}/issues/${pull.number}/comments`).catch(() => []),
    getPages(query, `${repo}/pulls/${pull.number}/reviews`).catch(() => []),
  ])
  const patches = diff ? splitDiff(diff) : new Map<string, SplitPatch>()
  const contexts = asRecord(statuses).statuses

  return {
    forgeId: GITHUB_ID,
    number: pull.number,
    title: asString(pull.title),
    body: asString(pull.body),
    url: asString(pull.url),
    author: authorLogin(pull.author),
    base: asString(pull.base),
    head: asString(pull.head),
    isDraft: pull.isDraft === true,
    files: buildFiles(asFiles(files), patches),
    checks: [
      ...asChecks(runs.map(runCheck)),
      ...asChecks(Array.isArray(contexts) ? contexts.map(statusCheck) : []),
    ],
    comments: asComments(
      comments.map((item) => {
        const raw = asRecord(item)
        return { author: raw.user, body: raw.body, createdAt: raw.created_at }
      }),
      reviews.map((item) => {
        const raw = asRecord(item)
        return { author: raw.user, body: raw.body, state: raw.state, submittedAt: raw.submitted_at }
      }),
    ),
  }
}

function parsePull(value: unknown): Pull | null {
  const raw = asRecord(value)
  if (typeof raw.number !== 'number') return null
  if (asString(raw.state).toLowerCase() !== 'open') return null
  const head = asRecord(raw.head)
  return {
    number: raw.number,
    nodeId: asString(raw.node_id),
    title: raw.title,
    body: raw.body,
    url: raw.html_url,
    author: raw.user,
    base: asRecord(raw.base).ref,
    head: head.ref,
    headSha: asString(head.sha),
    isDraft: raw.draft,
  }
}

/** REST check run, reshaped to what `asCheck` reads. */
function runCheck(item: unknown): unknown {
  const raw = asRecord(item)
  return { name: raw.name, status: raw.status, conclusion: raw.conclusion, detailsUrl: raw.html_url }
}

/** REST commit status, reshaped to what `asCheck` reads. */
function statusCheck(item: unknown): unknown {
  const raw = asRecord(item)
  return { __typename: 'StatusContext', context: raw.context, state: raw.state, targetUrl: raw.target_url }
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

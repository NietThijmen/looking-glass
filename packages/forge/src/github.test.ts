import { describe, expect, it } from 'vitest'
import { GithubForge } from './github'
import type { PullRequestQuery } from './types'

const DIFF = `diff --git a/src/button.tsx b/src/button.tsx
index 111..222 100644
--- a/src/button.tsx
+++ b/src/button.tsx
@@ -1,2 +1,3 @@
 line
-old
+new
+extra
`

const PULL = {
  number: 12,
  node_id: 'PR_node',
  title: 'Update the button',
  body: 'Ship the button.',
  html_url: 'https://github.com/acme/app/pull/12',
  user: { login: 'ada' },
  base: { ref: 'main' },
  head: { ref: 'button', sha: 'abc123' },
  state: 'open',
  draft: true,
}

const base: Omit<PullRequestQuery, 'fetch'> = {
  cwd: '/work',
  remote: { host: 'github.com', owner: 'acme', repo: 'app' },
  branch: 'button',
  token: 'tok',
}

type Call = { url: string; method: string; body: unknown; accept: string }

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

/** A fetch that answers from `routes` (matched by URL suffix, first hit wins) and records calls. */
function scripted(routes: Record<string, () => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fake = (async (input: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      url: input,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      accept: headers.Accept ?? '',
    })
    const key = Object.keys(routes).find((route) => input.includes(route))
    return key ? routes[key]!() : json({ message: 'not found' }, 404)
  }) as unknown as typeof fetch
  return { fetch: fake, calls }
}

const openRoutes = (pull: unknown = PULL): Record<string, () => Response> => ({
  '/pulls?state=open': () => json([pull]),
  '/pulls/12/files': () => json([{ filename: 'src/button.tsx', additions: 2, deletions: 1 }]),
  '/pulls/12/reviews': () =>
    json([
      { user: { login: 'cy' }, body: '', state: 'APPROVED', submitted_at: '2026-01-03T00:00:00Z' },
      { user: { login: 'cy' }, body: '', state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' },
      {
        user: { login: 'dee' },
        body: 'Rename it.',
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ]),
  '/pulls/12': () => new Response(DIFF),
  '/check-runs': () =>
    json({
      check_runs: [
        {
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/acme/app/actions/runs/1',
        },
      ],
    }),
  '/status': () => json({ statuses: [] }),
  '/issues/12/comments': () =>
    json([{ user: { login: 'bob' }, body: 'Looks close.', created_at: '2026-01-02T00:00:00Z' }]),
})

describe('GithubForge', () => {
  it('matches github.com only', () => {
    expect(GithubForge.matches({ host: 'github.com', owner: 'acme', repo: 'app' })).toBe(true)
    expect(GithubForge.matches({ host: 'gitlab.com', owner: 'acme', repo: 'app' })).toBe(false)
    expect(GithubForge.matches({ host: 'github.example.com', owner: 'acme', repo: 'app' })).toBe(false)
  })

  it('maps an open pull request, including one file patch and one failed check', async () => {
    const { fetch, calls } = scripted(openRoutes())
    const detail = await GithubForge.pullRequest({ ...base, fetch })
    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/acme/app/pulls?state=open&head=acme%3Abutton&per_page=1',
      method: 'GET',
    })
    expect(calls.find((call) => call.accept === 'application/vnd.github.v3.diff')?.url).toBe(
      'https://api.github.com/repos/acme/app/pulls/12',
    )
    expect(detail).toEqual({
      forgeId: 'github',
      number: 12,
      title: 'Update the button',
      body: 'Ship the button.',
      url: 'https://github.com/acme/app/pull/12',
      author: 'ada',
      base: 'main',
      head: 'button',
      isDraft: true,
      files: [{ path: 'src/button.tsx', status: 'modified', additions: 2, deletions: 1, patch: DIFF }],
      checks: [
        {
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          url: 'https://github.com/acme/app/actions/runs/1',
        },
      ],
      comments: [
        { author: 'dee', body: 'Rename it.', createdAt: '2026-01-01T00:00:00Z', review: 'changes_requested' },
        { author: 'bob', body: 'Looks close.', createdAt: '2026-01-02T00:00:00Z', review: null },
        { author: 'cy', body: '', createdAt: '2026-01-03T00:00:00Z', review: 'approved' },
      ],
    })
  })

  it('sends the token as a bearer header', async () => {
    let auth = ''
    const fetch = (async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization ?? ''
      return json([])
    }) as unknown as typeof globalThis.fetch
    await GithubForge.pullRequest({ ...base, fetch })
    expect(auth).toBe('Bearer tok')
  })

  it('sends each action to its endpoint', async () => {
    const { fetch, calls } = scripted({
      '/pulls/12/merge': () => json({ merged: true }),
      '/issues/12/comments': () => json({}, 201),
      '/pulls/12': () => json(PULL),
      '/graphql': () => json({ data: {} }),
    })
    const query = { ...base, fetch }
    expect(await GithubForge.act(query, 12, { kind: 'editBody', body: 'New body' })).toEqual({ ok: true })
    expect(await GithubForge.act(query, 12, { kind: 'comment', body: 'Hi' })).toEqual({ ok: true })
    expect(await GithubForge.act(query, 12, { kind: 'merge', method: 'squash' })).toEqual({ ok: true })
    expect(await GithubForge.act(query, 12, { kind: 'ready' })).toEqual({ ok: true })
    expect(await GithubForge.act(query, 12, { kind: 'draft' })).toEqual({ ok: true })
    const summary = calls.map((call) => `${call.method} ${call.url.replace('https://api.github.com', '')}`)
    expect(summary).toEqual([
      'PATCH /repos/acme/app/pulls/12',
      'POST /repos/acme/app/issues/12/comments',
      'PUT /repos/acme/app/pulls/12/merge',
      'GET /repos/acme/app/pulls/12',
      'POST /graphql',
      'GET /repos/acme/app/pulls/12',
      'POST /graphql',
    ])
    expect(calls[0]!.body).toEqual({ body: 'New body' })
    expect(calls[2]!.body).toEqual({ merge_method: 'squash' })
    expect(JSON.stringify(calls[4]!.body)).toContain('markPullRequestReadyForReview')
    expect(JSON.stringify(calls[6]!.body)).toContain('convertPullRequestToDraft')
  })

  it('reports a failed action with the GitHub message', async () => {
    const { fetch } = scripted({ '/pulls/12/merge': () => json({ message: 'not mergeable' }, 405) })
    expect(await GithubForge.act({ ...base, fetch }, 12, { kind: 'merge', method: 'merge' })).toEqual({
      ok: false,
      error: 'not mergeable',
    })
  })

  it('reports a missing token on an action', async () => {
    const { fetch } = scripted({})
    const result = await GithubForge.act({ ...base, token: null, fetch }, 12, { kind: 'ready' })
    expect(result.ok).toBe(false)
  })

  it('returns null for a closed pull request', async () => {
    const { fetch } = scripted(openRoutes({ ...PULL, state: 'closed' }))
    expect(await GithubForge.pullRequest({ ...base, fetch })).toBeNull()
  })

  it('returns null when no pull request matches the branch', async () => {
    const { fetch } = scripted({ '/pulls?state=open': () => json([]) })
    expect(await GithubForge.pullRequest({ ...base, fetch })).toBeNull()
  })

  it('returns null without a token', async () => {
    const { fetch, calls } = scripted(openRoutes())
    expect(await GithubForge.pullRequest({ ...base, token: null, fetch })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null when the request fails or throws', async () => {
    const failing = scripted({ '/pulls?state=open': () => json({ message: 'Bad credentials' }, 401) })
    expect(await GithubForge.pullRequest({ ...base, fetch: failing.fetch })).toBeNull()
    const throwing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    expect(await GithubForge.pullRequest({ ...base, fetch: throwing })).toBeNull()
  })
})

describe('GithubForge.list', () => {
  it('lists open pull requests and flags forks', async () => {
    const fork = { ...PULL, number: 13, head: { ref: 'x', sha: 's', repo: { full_name: 'zed/app' } } }
    const same = {
      ...PULL,
      head: { ...PULL.head, repo: { full_name: 'acme/app' } },
      base: { ref: 'main', repo: { full_name: 'acme/app' } },
    }
    const { fetch } = scripted({ '/pulls?state=open': () => json([same, { ...fork, base: same.base }]) })
    const result = await GithubForge.list({ ...base, fetch })
    expect(result.ok && result.pullRequests.map((pr) => [pr.number, pr.fromFork])).toEqual([
      [12, false],
      [13, true],
    ])
  })

  it('reports why listing failed', async () => {
    expect(await GithubForge.list({ ...base, token: null, fetch: scripted({}).fetch })).toMatchObject({
      ok: false,
      error: expect.stringContaining('token'),
    })
  })
})

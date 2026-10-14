import { describe, expect, it } from 'vitest'
import { actionArgs, GithubForge } from './github'
import type { CommandRun } from './run'
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

const OPEN = {
  number: 12,
  title: 'Update the button',
  body: 'Ship the button.',
  url: 'https://github.com/acme/app/pull/12',
  author: { login: 'ada' },
  baseRefName: 'main',
  headRefName: 'button',
  state: 'OPEN',
  isDraft: true,
  files: [{ path: 'src/button.tsx', additions: 2, deletions: 1 }],
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/acme/app/actions/runs/1',
    },
  ],
  comments: [{ author: { login: 'bob' }, body: 'Looks close.', createdAt: '2026-01-02T00:00:00Z' }],
  reviews: [
    { author: { login: 'cy' }, body: '', state: 'APPROVED', submittedAt: '2026-01-03T00:00:00Z' },
    { author: { login: 'cy' }, body: '', state: 'COMMENTED', submittedAt: '2026-01-01T00:00:00Z' },
    {
      author: { login: 'dee' },
      body: 'Rename it.',
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-01-01T00:00:00Z',
    },
  ],
}

const base: Omit<PullRequestQuery, 'run'> = {
  cwd: '/work',
  remote: { host: 'github.com', owner: 'acme', repo: 'app' },
  branch: 'button',
}

function scripted(
  view: { code?: number; body?: unknown },
  diff = DIFF,
): {
  run: CommandRun
  calls: string[][]
} {
  const calls: string[][] = []
  const run: CommandRun = async (command, args) => {
    calls.push([command, ...args])
    if (args[1] === 'view') {
      if (view.code) return { code: view.code, stdout: '', stderr: 'no pr' }
      return { code: 0, stdout: JSON.stringify(view.body), stderr: '' }
    }
    if (args[1] === 'diff') return { code: 0, stdout: diff, stderr: '' }
    return { code: 1, stdout: '', stderr: '' }
  }
  return { run, calls }
}

describe('GithubForge', () => {
  it('matches github.com only', () => {
    expect(GithubForge.matches({ host: 'github.com', owner: 'acme', repo: 'app' })).toBe(true)
    expect(GithubForge.matches({ host: 'gitlab.com', owner: 'acme', repo: 'app' })).toBe(false)
    expect(GithubForge.matches({ host: 'github.example.com', owner: 'acme', repo: 'app' })).toBe(false)
  })

  it('maps an open pull request, including one file patch and one failed check', async () => {
    const { run, calls } = scripted({ body: OPEN })
    const detail = await GithubForge.pullRequest({ ...base, run })
    expect(calls[0]).toEqual([
      'gh',
      'pr',
      'view',
      'button',
      '--repo',
      'acme/app',
      '--json',
      'number,title,body,url,author,baseRefName,headRefName,state,isDraft,files,statusCheckRollup,comments,reviews',
    ])
    expect(calls[1]).toEqual(['gh', 'pr', 'diff', '12', '--repo', 'acme/app'])
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
      files: [
        {
          path: 'src/button.tsx',
          status: 'modified',
          additions: 2,
          deletions: 1,
          patch: DIFF,
        },
      ],
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

  it('builds gh arguments for each action', () => {
    expect(actionArgs(12, { kind: 'editBody', body: 'New body' })).toEqual([
      'pr',
      'edit',
      '12',
      '--body',
      'New body',
    ])
    expect(actionArgs(12, { kind: 'comment', body: 'Hi' })).toEqual(['pr', 'comment', '12', '--body', 'Hi'])
    expect(actionArgs(12, { kind: 'draft' })).toEqual(['pr', 'ready', '12', '--undo'])
    expect(actionArgs(12, { kind: 'ready' })).toEqual(['pr', 'ready', '12'])
    expect(actionArgs(12, { kind: 'merge', method: 'squash' })).toEqual(['pr', 'merge', '12', '--squash'])
  })

  it('reports a failed action with gh stderr', async () => {
    const calls: string[][] = []
    const run: CommandRun = async (command, args) => {
      calls.push([command, ...args])
      return { code: 1, stdout: '', stderr: 'not mergeable\n' }
    }
    expect(await GithubForge.act({ ...base, run }, 12, { kind: 'ready' })).toEqual({
      ok: false,
      error: 'not mergeable',
    })
    expect(calls[0]).toEqual(['gh', 'pr', 'ready', '12', '--repo', 'acme/app'])
  })

  it('returns null for a closed pull request', async () => {
    const { run, calls } = scripted({ body: { ...OPEN, state: 'CLOSED' } })
    expect(await GithubForge.pullRequest({ ...base, run })).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('returns null when gh exits non-zero', async () => {
    const { run } = scripted({ code: 1 })
    expect(await GithubForge.pullRequest({ ...base, run })).toBeNull()
  })

  it('returns null when the command runner throws', async () => {
    const run: CommandRun = () => Promise.reject(new Error('gh missing'))
    expect(await GithubForge.pullRequest({ ...base, run })).toBeNull()
  })
})

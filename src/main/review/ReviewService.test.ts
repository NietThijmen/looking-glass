import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewEntry } from '../../shared/review'
import { WorkspaceService } from '../workspace/WorkspaceService'
import { Checkpoints } from './Checkpoints'
import { ReviewService } from './ReviewService'

let tmp: string
let root: string
let review: ReviewService
let published: ReviewEntry[][]

const write = (rel: string, text: string) => fs.writeFile(path.join(root, rel), text)
const read = (rel: string) => fs.readFile(path.join(root, rel), 'utf8')
const exists = (rel: string) =>
  fs.access(path.join(root, rel)).then(
    () => true,
    () => false,
  )

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-review-')))
  root = path.join(tmp, 'project')
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await write('a.ts', 'one\ntwo\n')
  await write('b.ts', 'bee\n')
  await write('node_modules/pkg/index.js', 'ignored')
  const workspace = new WorkspaceService()
  await workspace.open(root)
  const checkpoints = new Checkpoints(root, path.join(tmp, 'storage'))
  published = []
  review = new ReviewService(
    workspace,
    () => checkpoints,
    (e) => published.push(e),
  )
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('ReviewService', () => {
  it('collects files changed during a turn, including ones written outside ACP', async () => {
    const checkpoint = await review.beginTurn('s1')
    expect(checkpoint).toMatch(/^[0-9a-f]{40}$/)
    await write('a.ts', 'one\nTWO\n')
    await write('c.ts', 'new\n')
    await fs.rm(path.join(root, 'b.ts'))
    await write('node_modules/pkg/index.js', 'changed but excluded')
    await review.endTurn('s1')

    expect(published.at(-1)).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'deleted' },
      { path: 'c.ts', status: 'added' },
    ])
    expect(review.base('a.ts')).toBe('one\ntwo\n')
    expect(review.base('c.ts')).toBeNull()
  })

  it('rejects by restoring the baseline, deleting added files', async () => {
    await review.beginTurn('s1')
    await write('a.ts', 'changed\n')
    await write('c.ts', 'new\n')
    await review.endTurn('s1')
    await review.reject(null)
    expect(await read('a.ts')).toBe('one\ntwo\n')
    expect(await exists('c.ts')).toBe(false)
    expect(published.at(-1)).toEqual([])
  })

  it('accepts by dropping the entry and keeping disk as is', async () => {
    await review.beginTurn('s1')
    await write('a.ts', 'changed\n')
    await review.endTurn('s1')
    await review.accept('a.ts')
    expect(await read('a.ts')).toBe('changed\n')
    expect(published.at(-1)).toEqual([])
  })

  it('drops entries once hunk decisions bring the file back to its baseline', async () => {
    await review.beginTurn('s1')
    await write('a.ts', 'one\nTWO\n')
    await review.endTurn('s1')
    await review.setBase('a.ts', 'one\nTWO\n')
    expect(published.at(-1)).toEqual([])
  })

  it('keeps the original baseline across turns', async () => {
    await review.beginTurn('s1')
    await write('a.ts', 'first edit\n')
    await review.endTurn('s1')
    await review.beginTurn('s1')
    await write('a.ts', 'second edit\n')
    await review.endTurn('s1')
    expect(review.base('a.ts')).toBe('one\ntwo\n')
  })

  it('restores a checkpoint', async () => {
    const checkpoint = (await review.beginTurn('s1'))!
    await write('a.ts', 'changed\n')
    await write('c.ts', 'new\n')
    await fs.rm(path.join(root, 'b.ts'))
    await review.endTurn('s1')
    await review.restore(checkpoint)
    expect(await read('a.ts')).toBe('one\ntwo\n')
    expect(await read('b.ts')).toBe('bee\n')
    expect(await exists('c.ts')).toBe(false)
    expect(published.at(-1)).toEqual([])
  })

  it('records ACP writes even without a checkpoint', async () => {
    await write('a.ts', 'agent wrote this\n')
    await review.recordAgentWrite('a.ts', 'one\ntwo\n')
    expect(published.at(-1)).toEqual([{ path: 'a.ts', status: 'modified' }])
  })

  it('never touches a git repo in the workspace', async () => {
    await fs.mkdir(path.join(root, '.git'))
    await write('.git/HEAD', 'ref: refs/heads/main\n')
    await review.beginTurn('s1')
    await review.endTurn('s1')
    expect(await read('.git/HEAD')).toBe('ref: refs/heads/main\n')
    expect(await fs.readdir(path.join(root, '.git'))).toEqual(['HEAD'])
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitService, parsePorcelainV2 } from './git'

const z = (...records: string[]): string => records.join('\0') + '\0'

describe('parsePorcelainV2', () => {
  it('parses branch, ordinary, rename, unmerged and untracked records', () => {
    const output = z(
      '# branch.oid abc',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
      '1 A. N... 000000 100644 100644 000 bbb src/new file.ts',
      '1 D. N... 100644 000000 000000 aaa 000 old.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts',
      'src/original.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? notes.md',
    )
    expect(parsePorcelainV2(output)).toEqual({
      branch: 'main',
      entries: [
        { path: 'conflict.ts', status: 'conflicted', staged: false },
        { path: 'notes.md', status: 'untracked', staged: false },
        { path: 'old.ts', status: 'deleted', staged: true },
        { path: 'src/app.ts', status: 'modified', staged: false },
        { path: 'src/new file.ts', status: 'added', staged: true },
        { path: 'src/renamed.ts', status: 'renamed', staged: true, from: 'src/original.ts' },
      ],
    })
  })

  it('reports detached HEAD as a null branch', () => {
    expect(parsePorcelainV2(z('# branch.head (detached)')).branch).toBeNull()
  })

  it('makes paths workspace-relative and drops entries outside the prefix', () => {
    const output = z('1 .M N... 100644 100644 100644 a b pkg/web/src/a.ts', '? other/b.ts')
    expect(parsePorcelainV2(output, 'pkg/web/').entries).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false },
    ])
  })
})

describe('GitService', () => {
  let tmp: string | undefined
  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true })
  })

  it('reads status and HEAD contents from a real repo subdirectory', async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-git-')))
    const run = (...args: string[]): void => {
      execFileSync('git', args, { cwd: tmp, stdio: 'ignore' })
    }
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'Test')
    await fs.mkdir(path.join(tmp, 'web'))
    await fs.writeFile(path.join(tmp, 'web', 'a.ts'), 'one\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    await fs.writeFile(path.join(tmp, 'web', 'a.ts'), 'two\n')
    await fs.writeFile(path.join(tmp, 'web', 'b.ts'), 'new\n')

    const git = new GitService()
    const workspace = path.join(tmp, 'web')
    expect(await git.status(workspace)).toEqual({
      branch: 'main',
      entries: [
        { path: 'a.ts', status: 'modified', staged: false },
        { path: 'b.ts', status: 'untracked', staged: false },
      ],
    })
    expect(await git.headContents(workspace, 'a.ts')).toBe('one\n')
    expect(await git.headContents(workspace, 'b.ts')).toBeNull()
  })

  it('returns null outside a repository', async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-nogit-')))
    expect(await new GitService().status(tmp)).toBeNull()
  })
})

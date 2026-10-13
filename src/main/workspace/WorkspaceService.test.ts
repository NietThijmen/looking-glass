import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, WorkspaceService } from './WorkspaceService'

let tmp: string
let root: string
let outside: string
let ws: WorkspaceService

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-ws-')))
  root = path.join(tmp, 'project')
  outside = path.join(tmp, 'outside')
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true })
  await fs.mkdir(path.join(root, '.git'))
  await fs.mkdir(outside)
  await fs.writeFile(path.join(root, 'README.md'), '# hi\n')
  await fs.writeFile(path.join(root, 'src', 'b10.ts'), 'b10')
  await fs.writeFile(path.join(root, 'src', 'b2.ts'), 'b2')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
  ws = new WorkspaceService()
  await ws.open(root)
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('WorkspaceService', () => {
  it('lists directories first, naturally sorted, hiding .git', async () => {
    expect(await ws.readDir('')).toEqual([
      { name: 'src', path: 'src', kind: 'dir' },
      { name: 'README.md', path: 'README.md', kind: 'file' },
    ])
    expect((await ws.readDir('src')).map((e) => e.name)).toEqual(['nested', 'b2.ts', 'b10.ts'])
  })

  it('reads and writes text files', async () => {
    await ws.writeFile('src/new/file.ts', 'export {}\n')
    const read = await ws.readFile('src/new/file.ts')
    expect(read.contents).toBe('export {}\n')
    expect(read.binary).toBe(false)
  })

  it('flags binary and oversized files without returning contents', async () => {
    await fs.writeFile(path.join(root, 'img.bin'), Buffer.from([1, 2, 0, 3]))
    expect(await ws.readFile('img.bin')).toMatchObject({ binary: true, contents: '' })

    await fs.writeFile(path.join(root, 'big.txt'), Buffer.alloc(MAX_FILE_BYTES + 1, 'a'))
    expect(await ws.readFile('big.txt')).toMatchObject({ tooLarge: true, contents: '' })
  })

  it('rejects lexical traversal', async () => {
    await expect(ws.readFile('../outside/secret.txt')).rejects.toThrow(/escapes/)
    await expect(ws.writeFile('../outside/x.txt', 'x')).rejects.toThrow(/escapes/)
  })

  it('rejects symlinks that point outside the workspace', async () => {
    await fs.symlink(outside, path.join(root, 'link'))
    await expect(ws.readFile('link/secret.txt')).rejects.toThrow(/symlink/)
    await expect(ws.writeFile('link/new.txt', 'x')).rejects.toThrow(/symlink/)
    expect((await ws.readDir('')).map((e) => e.name)).not.toContain('link')
  })

  it('follows symlinks that stay inside the workspace', async () => {
    await fs.symlink(path.join(root, 'src'), path.join(root, 'src-link'))
    expect((await ws.readDir('')).find((e) => e.name === 'src-link')).toMatchObject({ kind: 'dir' })
    expect((await ws.readFile('src-link/b2.ts')).contents).toBe('b2')
  })

  it('refuses everything when no workspace is open', async () => {
    ws.close()
    await expect(ws.readDir('')).rejects.toThrow(/No workspace/)
  })
})

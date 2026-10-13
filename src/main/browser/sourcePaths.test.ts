import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeUrl } from './BrowserService'
import { toWorkspacePath } from './sourcePaths'

let root: string
beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-src-')))
  await fs.mkdir(path.join(root, 'src', 'components'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'components', 'Hero.tsx'), '')
  await fs.writeFile(path.join(root, 'src', 'styles.css'), '')
})
afterAll(() => fs.rm(root, { recursive: true, force: true }))

describe('toWorkspacePath', () => {
  it('maps dev-server URLs, including Vite /@fs and query strings', async () => {
    expect(await toWorkspacePath(root, 'http://localhost:5173/src/styles.css?t=123')).toBe('src/styles.css')
    expect(await toWorkspacePath(root, `http://localhost:5173/@fs${root}/src/components/Hero.tsx`)).toBe(
      'src/components/Hero.tsx',
    )
  })

  it('maps absolute, file:// and bundler paths', async () => {
    expect(await toWorkspacePath(root, path.join(root, 'src/components/Hero.tsx'))).toBe(
      'src/components/Hero.tsx',
    )
    expect(await toWorkspacePath(root, `file://${root}/src/styles.css`)).toBe('src/styles.css')
    expect(await toWorkspacePath(root, 'webpack:///./src/styles.css')).toBe('src/styles.css')
  })

  it('rejects missing files and paths outside the workspace', async () => {
    expect(await toWorkspacePath(root, 'http://localhost:5173/src/missing.css')).toBeNull()
    expect(await toWorkspacePath(root, '/etc/hosts')).toBeNull()
    expect(await toWorkspacePath(root, '../outside.ts')).toBeNull()
    expect(await toWorkspacePath(root, 'http://localhost:5173/')).toBeNull()
  })
})

describe('normalizeUrl', () => {
  it('adds a scheme to bare hosts', () => {
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app')
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com/x')).toBe('https://example.com/x')
  })
})

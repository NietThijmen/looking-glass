import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '../../shared/diagnostics'
import { formatDiagnostics } from '../../shared/diagnostics'
import { WorkspaceService } from '../workspace/WorkspaceService'
import { DiagnosticsService, languageId } from './DiagnosticsService'

let tmp: string
let service: DiagnosticsService
let changes: Array<[string, Diagnostic[]]>

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-lsp-')))
  await fs.writeFile(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['*.ts'] }),
  )
  await fs.writeFile(path.join(tmp, 'bad.ts'), 'export const n: number = "nope"\n')
  await fs.writeFile(path.join(tmp, 'good.ts'), 'export const n: number = 1\n')
  // The server looks for the workspace's own TypeScript first.
  await fs.mkdir(path.join(tmp, 'node_modules'))
  await fs.symlink(
    path.resolve('node_modules/typescript'),
    path.join(tmp, 'node_modules', 'typescript'),
    'dir',
  )
  const workspace = new WorkspaceService()
  await workspace.open(tmp)
  changes = []
  service = new DiagnosticsService({ workspace, onChange: (p, d) => changes.push([p, d]) })
})

afterEach(async () => {
  await service.dispose()
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('languageId', () => {
  it('maps TS and JS extensions', () => {
    expect(languageId('src/a.tsx')).toBe('typescriptreact')
    expect(languageId('a.mjs')).toBe('javascript')
    expect(languageId('README.md')).toBeNull()
  })
})

describe('DiagnosticsService with typescript-language-server', () => {
  it('reports type errors for a file an agent asks about', async () => {
    const result = await service.diagnostics('bad.ts')
    expect(result['bad.ts']?.[0]).toMatchObject({ severity: 'error', source: 'typescript', code: 2322 })
    expect(formatDiagnostics(result)).toMatch(/^bad\.ts:1:14 error \(typescript 2322\): Type 'string'/)
    expect(await service.diagnostics('good.ts')).toEqual({})
  }, 30_000)

  it('follows unsaved editor contents', async () => {
    await service.diagnostics('good.ts')
    await service.syncEditor({
      openFiles: ['good.ts'],
      activeFile: 'good.ts',
      dirty: { 'good.ts': 'export const n: number = "x"\n' },
    })
    await expect.poll(() => service.all()['good.ts']?.length ?? 0, { timeout: 15_000 }).toBe(1)
    expect(changes.some(([p, d]) => p === 'good.ts' && d.length === 1)).toBe(true)
  }, 30_000)
})

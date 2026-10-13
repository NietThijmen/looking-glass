#!/usr/bin/env node
// Builds a throwaway git workspace, launches the app against it with
// LOOKINGGLASS_SMOKE=1, and exits with the app's exit code.
//
//   node scripts/smoke.mjs                      # run the built app (out/) with dev Electron
//   node scripts/smoke.mjs path/to/Lookingglass # run a packaged binary
//   SCREENSHOT=shot.png node scripts/smoke.mjs  # also save a screenshot
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-smoke-')))
const workspace = path.join(tmp, 'workspace')

const write = (rel, contents) => {
  fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true })
  fs.writeFileSync(path.join(workspace, rel), contents)
}
const git = (...args) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })

write('README.md', '# Smoke fixture\n')
write('src/app.ts', 'export const greeting = "hello"\n')
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'must not be readable')
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'smoke@example.com')
git('config', 'user.name', 'Smoke')
git('add', '.')
git('commit', '-q', '-m', 'fixture')
write('src/app.ts', 'export const greeting = "hello"\nconsole.log(greeting)\n')

const [binary, args] = process.argv[2]
  ? [process.argv[2], []]
  : [path.join(repoRoot, 'node_modules', '.bin', 'electron'), [repoRoot]]

const child = spawn(binary, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    LOOKINGGLASS_SMOKE: '1',
    LOOKINGGLASS_WORKSPACE: workspace,
    ...(process.env.SCREENSHOT
      ? { LOOKINGGLASS_SMOKE_SCREENSHOT: path.resolve(process.env.SCREENSHOT) }
      : {}),
  },
})

child.on('exit', (code) => {
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(code ?? 1)
})

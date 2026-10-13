#!/usr/bin/env node
// node-pty's macOS/Linux prebuilds ship `spawn-helper` without the execute bit
// in some installs (pnpm's store drops it), which makes every spawn fail with
// "posix_spawnp failed". Restore it after install.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
let root
try {
  root = path.dirname(require.resolve('node-pty/package.json'))
} catch {
  process.exit(0)
}

for (const dir of ['prebuilds', 'build/Release']) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) continue
  const candidates = dir === 'prebuilds' ? fs.readdirSync(base).map((p) => path.join(base, p)) : [base]
  for (const candidate of candidates) {
    const helper = path.join(candidate, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}

#!/usr/bin/env node
// Builds a throwaway git workspace, launches the app against it with
// LOOKINGGLASS_SMOKE=1, and exits with the app's exit code.
//
//   node scripts/smoke.mjs                      # run the app built into out-smoke/ with dev Electron
//   node scripts/smoke.mjs path/to/Lookingglass # run a packaged binary
//   SCREENSHOT=shot.png node scripts/smoke.mjs  # also save a screenshot
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
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
// A type error for the language server, which uses the workspace's own TypeScript.
write('src/types.ts', 'export const count: number = "three"\n')
write('.gitignore', 'node_modules/\n')
fs.mkdirSync(path.join(workspace, 'node_modules'))
fs.symlinkSync(
  path.join(repoRoot, 'node_modules', 'typescript'),
  path.join(workspace, 'node_modules', 'typescript'),
  'dir',
)
write(
  'site/index.html',
  `<!doctype html><html><head><title>Smoke site</title><link rel="stylesheet" href="/site/styles.css"></head>
<body><main><h1>Welcome back</h1><button class="cta" data-testid="cta" onclick="document.title='clicked'">Get started</button>
<img src="/site/missing.png" alt=""><script>console.error('smoke page error')</script></main></body></html>\n`,
)
write('site/styles.css', '.cta {\n  background: rgb(0, 120, 255);\n  padding: 8px 16px;\n}\n')
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'must not be readable')
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'smoke@example.com')
git('config', 'user.name', 'Smoke')
git('add', '.')
git('commit', '-q', '-m', 'fixture')
write('src/app.ts', 'export const greeting = "hello"\nconsole.log(greeting)\n')

// A tiny static server over the workspace, standing in for a dev server.
const server = http.createServer((req, res) => {
  const file = path.join(workspace, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(workspace) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(file, 'index.html')
    if (file.startsWith(workspace) && fs.existsSync(index)) return res.end(fs.readFileSync(index))
    res.writeHead(404).end('not found')
    return
  }
  res.setHeader(
    'Content-Type',
    file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream',
  )
  res.end(fs.readFileSync(file))
})
await new Promise((resolve) => server.listen(0, resolve))
const siteUrl = `http://localhost:${server.address().port}/site/`

const [binary, args] = process.argv[2]
  ? [process.argv[2], []]
  : // Its own build folder: `pnpm build` would replace out/ under a running `pnpm dev`.
    [
      path.join(repoRoot, 'node_modules', '.bin', 'electron'),
      [path.join(repoRoot, 'out-smoke', 'main', 'index.js')],
    ]

// Drop Electron's own variables in case we were started from an Electron process (for
// example by an agent inside Lookingglass): ELECTRON_RUN_AS_NODE would start the app as
// plain Node, ELECTRON_RENDERER_URL would load someone else's dev server.
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^ELECTRON_(RUN_AS_NODE|RENDERER_URL|EXEC_PATH|CLI_ARGS|MAJOR_VER)$|^NODE_ENV_ELECTRON_VITE$/.test(
        key,
      ),
  ),
)

if (!process.argv[2] && !fs.existsSync(path.join(repoRoot, 'out-smoke', 'renderer', 'index.html'))) {
  console.error('[smoke] FAIL out-smoke/renderer/index.html is missing: build with `pnpm smoke`')
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
}

const child = spawn(binary, args, {
  stdio: 'inherit',
  env: {
    ...inherited,
    LOOKINGGLASS_SMOKE: '1',
    LOOKINGGLASS_WORKSPACE: workspace,
    LOOKINGGLASS_SMOKE_SITE: siteUrl,
    LOOKINGGLASS_SMOKE_USER_DATA: path.join(tmp, 'user-data'),
    LOOKINGGLASS_HOME: path.join(tmp, 'lookingglass-home'),
    ...(process.env.SCREENSHOT
      ? { LOOKINGGLASS_SMOKE_SCREENSHOT: path.resolve(process.env.SCREENSHOT) }
      : {}),
  },
})

// The app gives up after 480s on its own; this catches an app that never gets that far.
const killTimer = setTimeout(() => {
  console.error('[smoke] FAIL app did not exit within 540s, killing it')
  child.kill('SIGKILL')
}, 540_000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(code ?? 1)
})

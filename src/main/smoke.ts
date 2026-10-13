import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import { send } from './ipc/typed'

/** A check is a page expression, or a main-side step that can drive real input. */
type Check =
  string | ((win: BrowserWindow, page: (expression: string) => Promise<unknown>) => Promise<unknown>)

/**
 * Self-checks run inside the real renderer when `LOOKINGGLASS_SMOKE=1`.
 * Each expression is evaluated in the page and must resolve to `true`.
 * `waitFor(fn)` polls until `fn()` is truthy (or times out).
 *
 * Workspace checks run only when `LOOKINGGLASS_WORKSPACE` points at the
 * fixture created by `scripts/smoke.mjs`.
 */
const helpers = `
  window.__lg = {
    waitFor: async (fn, ms = 8000) => {
      const end = Date.now() + ms
      for (;;) {
        try { const v = await fn(); if (v) return v } catch {}
        if (Date.now() > end) return false
        await new Promise((r) => setTimeout(r, 50))
      }
    },
    // Text content including open shadow roots (@pierre/diffs renders into one).
    deepText: (node) => {
      let text = ''
      const walk = (n) => {
        if (n.nodeType === 3) text += n.textContent
        if (n.shadowRoot) walk(n.shadowRoot)
        for (const c of n.childNodes) walk(c)
      }
      walk(node)
      return text
    },
    click: (selector) => { const el = document.querySelector(selector); el?.click(); return !!el },
  }
  true
`

const baseChecks: Record<string, Check> = {
  'preload API is exposed': `typeof window.lookingglass?.app?.getInfo === 'function'`,
  'IPC round-trip works': `window.lookingglass.app.getInfo().then((i) => typeof i.versions.electron === 'string')`,
  'no Node in renderer': `typeof require === 'undefined' && typeof process === 'undefined'`,
  'React rendered': `__lg.waitFor(() => document.querySelector('[data-testid="app-shell"]'))`,
  'CSP blocks eval': `(() => { try { eval('1'); return false } catch { return true } })()`,
}

const workspaceChecks: Record<string, Check> = {
  'explorer lists the workspace': `__lg.waitFor(() => document.querySelector('[data-testid="tree-item"][data-path="README.md"]'))`,
  'directories expand': `(async () => {
    __lg.click('[data-testid="tree-item"][data-path="src"]')
    return __lg.waitFor(() => document.querySelector('[data-testid="tree-item"][data-path="src/app.ts"]'))
  })()`,
  'files open in the editor': `(async () => {
    __lg.click('[data-testid="tree-item"][data-path="src/app.ts"]')
    return __lg.waitFor(() => {
      const el = document.querySelector('[data-testid="code-editor"][data-path="src/app.ts"]')
      return el && __lg.deepText(el).includes('console.log(greeting)')
    })
  })()`,
  'typing marks the tab dirty': async (win, page) => {
    // Click at the end of line 1 like a user would, then type.
    const point = (await page(`(() => {
      const host = document.querySelector('[data-testid="code-editor"] diffs-container')
      const line = host?.shadowRoot?.querySelector('[data-line="1"]')
      if (!line) return null
      const r = line.getBoundingClientRect()
      return { x: Math.round(r.right - 4), y: Math.round(r.top + r.height / 2) }
    })()`)) as { x: number; y: number } | null
    if (!point) return false
    for (const type of ['mouseDown', 'mouseUp'] as const) {
      win.webContents.sendInputEvent({ type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    win.webContents.insertText(' // typed')
    return page(`__lg.waitFor(() => document.querySelector('[data-testid="editor-tab"][data-dirty="true"]'))`)
  },
  'save writes the draft to disk': async (win, page) => {
    send(win.webContents, 'menu:command', 'save')
    return page(`__lg.waitFor(async () =>
      (await window.lookingglass.fs.readFile('src/app.ts')).contents.includes('// typed')
      && !document.querySelector('[data-testid="editor-tab"][data-dirty="true"]'))`)
  },
  'search panel reveals a match': async (win, page) => {
    send(win.webContents, 'menu:command', 'show-search')
    await page(`__lg.waitFor(() => document.activeElement?.dataset.testid === 'search-input')`)
    win.webContents.insertText('Smoke fixture')
    return page(`(async () => {
      const found = await __lg.waitFor(() => document.querySelector('[data-testid="search-match"]'))
      if (!found) console.log('input=' + document.querySelector('[data-testid="search-input"]').value + ' summary=' + document.querySelector('[data-testid="search-summary"]').textContent)
      __lg.click('[data-testid="search-match"]')
      return __lg.waitFor(() => document.querySelector('[data-testid="code-editor"][data-path="README.md"]'))
    })()`)
  },
  'revealed file takes keyboard focus': async (win, page) => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    win.webContents.insertText('typed ')
    return page(
      `__lg.waitFor(() => document.querySelector('[data-testid="editor-tab"][data-path="README.md"][data-dirty="true"]'))`,
    )
  },
  'git panel opens a diff': async (win, page) => {
    send(win.webContents, 'menu:command', 'show-git')
    return page(`(async () => {
      await __lg.waitFor(() => document.querySelector('[data-testid="git-entry"][data-path="src/app.ts"]'))
      __lg.click('[data-testid="git-entry"][data-path="src/app.ts"]')
      return __lg.waitFor(() => {
        const el = document.querySelector('[data-testid="diff-view"]')
        return el && __lg.deepText(el).includes('console.log(greeting)')
      })
    })()`)
  },
  'agent list includes Claude Code and the fake agent': `window.lookingglass.agent.list().then((a) =>
    a.some((x) => x.id === 'claude-code') && a.some((x) => x.id === 'fake'))`,
  'fake agent chat starts': `(async () => {
    __lg.click('[data-testid="start-agent"][data-agent-id="fake"]')
    return __lg.waitFor(() => document.querySelector('[data-testid="chat"][data-state="ready"]'), 15000)
  })()`,
  'agent reply streams and renders markdown': async (win, page) => {
    await say(win, page, 'hello there')
    return page(`__lg.waitFor(() => {
      const m = [...document.querySelectorAll('[data-testid="agent-message"]')].at(-1)
      return m && m.querySelector('strong')?.textContent === 'hello there'
        && document.querySelector('[data-testid="plan"]') && document.querySelector('[data-testid="tool-call"]')
    }, 10000) || console.log('chat=' + document.querySelector('[data-testid="chat"]')?.textContent.slice(0, 400))`)
  },
  'agent reads files through the editor': async (win, page) => {
    await say(win, page, 'read README.md')
    return page(`__lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
      .some((m) => /First line of README[.]md: .*typed/.test(m.textContent)), 10000)`)
  },
  'permission prompt reaches the user': async (win, page) => {
    await say(win, page, 'edit')
    return page(`(async () => {
      await __lg.waitFor(() => document.querySelector('[data-testid="permission-request"]'), 10000)
      __lg.click('[data-testid="permission-option"][data-option-id="reject"]')
      return __lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
        .some((m) => m.textContent.includes('Permission outcome: reject')), 10000)
    })()`)
  },
  'stop cancels a running turn': async (win, page) => {
    await say(win, page, 'slow')
    return page(`(async () => {
      await __lg.waitFor(() => document.querySelector('[data-testid="stop"]'))
      await new Promise((r) => setTimeout(r, 300))
      __lg.click('[data-testid="stop"]')
      return __lg.waitFor(() => document.querySelector('[data-testid="chat"][data-busy="false"]')
        && document.querySelector('[data-testid="chat"]').textContent.includes('Stopped'), 10000)
    })()`)
  },
  'path traversal is refused': `window.lookingglass.fs.readFile('../outside.txt').then(() => false, () => true)`,
  'search finds matches': `window.lookingglass.search.run({ pattern: 'greeting' })
    .then((r) => r.files.some((f) => f.path === 'src/app.ts') && r.matchCount >= 2)`,
  'git status shows changes': `__lg.waitFor(async () => {
    const s = await window.lookingglass.git.status()
    return s && s.branch === 'main' && s.entries.some((e) => e.path === 'src/app.ts' && e.status === 'modified')
  })`,
  'saving writes to disk': `(async () => {
    await window.lookingglass.fs.writeFile('notes.txt', 'saved from smoke')
    const r = await window.lookingglass.fs.readFile('notes.txt')
    return r.contents === 'saved from smoke'
  })()`,
  'watcher reports changes': `(async () => {
    let seen = false
    const off = window.lookingglass.fs.onChanged((c) => { if (c.some((x) => x.path === 'watched.txt')) seen = true })
    await window.lookingglass.fs.writeFile('watched.txt', 'x')
    const ok = await __lg.waitFor(() => seen)
    off()
    return ok
  })()`,
  'terminal renders with ghostty-web': `__lg.waitFor(() => document.querySelector('[data-testid="terminal"] canvas'))`,
  'terminal runs a shell': `(async () => {
    const id = await __lg.waitFor(() => document.querySelector('[data-testid="terminal"]')?.dataset.terminalId)
    if (!id) return false
    let out = ''
    const off = window.lookingglass.terminal.onData((e) => { if (e.id === id) out += e.data })
    await window.lookingglass.terminal.write(id, 'echo lg-$((40+2))\\r')
    const ok = await __lg.waitFor(() => out.includes('lg-42'), 10000)
    off()
    return ok
  })()`,
}

/** Type a message into the chat composer and send it, like a user. */
async function say(win: BrowserWindow, page: (e: string) => Promise<unknown>, text: string): Promise<void> {
  await page(`__lg.waitFor(() => document.querySelector('[data-testid="chat"][data-busy="false"] [data-testid="composer"]:not(:disabled)'))
    .then(() => document.querySelector('[data-testid="composer"]').focus())`)
  win.webContents.insertText(text)
  const typed = await page(
    `__lg.waitFor(() => document.querySelector('[data-testid="composer"]').value === ${JSON.stringify(text)}, 2000)`,
  )
  if (!typed) throw new Error(`composer did not receive "${text}"`)
  await page(
    `__lg.waitFor(() => !document.querySelector('[data-testid="send"]')?.disabled).then(() => __lg.click('[data-testid="send"]'))`,
  )
}

/** Opt-in (`LOOKINGGLASS_SMOKE_CLAUDE=1`): a real Claude Code turn. Needs a logged-in `claude` and uses a few tokens. */
const claudeChecks: Record<string, Check> = {
  'Claude Code answers through ACP': async (win, page) => {
    await page(`(async () => {
      __lg.click('[data-testid="new-chat"]')
      await __lg.waitFor(() => document.querySelector('[data-testid="new-chat-agent"][data-agent-id="claude-code"]'))
      __lg.click('[data-testid="new-chat-agent"][data-agent-id="claude-code"]')
      return __lg.waitFor(() => document.querySelector('[data-testid="chat"][data-state="ready"]'), 30000)
    })()`)
    await say(win, page, 'Reply with exactly: lookingglass-ok')
    return page(`__lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
      .some((m) => m.textContent.includes('lookingglass-ok')), 90000)`)
  },
}

export function runSmokeTest(win: BrowserWindow): void {
  const fail = (message: string): void => {
    console.error(`[smoke] FAIL ${message}`)
    app.exit(1)
  }
  const timeout = setTimeout(() => fail('timed out after 240s'), 240_000)
  win.webContents.on('console-message', (event) => console.log(`[page] ${event.message}`))
  const checks = {
    ...baseChecks,
    ...(process.env['LOOKINGGLASS_WORKSPACE'] ? workspaceChecks : {}),
    ...(process.env['LOOKINGGLASS_SMOKE_CLAUDE'] === '1' ? claudeChecks : {}),
  }

  win.webContents.once('did-fail-load', (_e, code, description) => fail(`load ${code} ${description}`))
  win.webContents.once('did-finish-load', async () => {
    await win.webContents.executeJavaScript(helpers)
    // Run every check (later ones rarely depend on earlier ones) so one run shows all failures.
    const failures: string[] = []
    const page = (expression: string): Promise<unknown> => win.webContents.executeJavaScript(expression)
    for (const [name, check] of Object.entries(checks)) {
      let ok: unknown
      try {
        ok = typeof check === 'string' ? await page(check) : await check(win, page)
      } catch (error) {
        ok = false
        console.error(`[smoke]      ${String(error)}`)
      }
      const passed = ok !== false && ok !== null && ok !== undefined
      if (!passed) failures.push(name)
      console.log(`[smoke] ${passed ? 'ok  ' : 'FAIL'} ${name}`)
    }

    const screenshot = process.env['LOOKINGGLASS_SMOKE_SCREENSHOT']
    if (screenshot) {
      win.show()
      await new Promise((resolve) => setTimeout(resolve, 800))
      await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
      console.log(`[smoke] screenshot ${screenshot}`)
    }

    clearTimeout(timeout)
    if (failures.length) return fail(`${failures.length} check(s): ${failures.join(', ')}`)
    console.log('[smoke] all checks passed')
    app.exit(0)
  })
}

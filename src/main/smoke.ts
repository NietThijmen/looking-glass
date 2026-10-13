import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { webContents, type WebContents } from 'electron'
import { browserSession } from './browser/BrowserService'
import { editorMcp } from './ipc/agent'
import { browser } from './ipc/browser'
import { send } from './ipc/typed'

/** The page in the (single) smoke browser tab. */
function browserContents(): WebContents | undefined {
  const ses = browserSession()
  return webContents.getAllWebContents().find((wc) => wc.session === ses && !wc.isDestroyed())
}

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
    treeRoot: () => document.querySelector('[data-testid="explorer"]')?.shadowRoot ?? null,
    treeItem: (path) => {
      const root = window.__lg.treeRoot()
      return root?.querySelector('[data-item-path="' + path + '"]') ?? null
    },
    clickTree: (path) => {
      const el = window.__lg.treeItem(path)
      el?.click()
      return !!el
    },
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
  'explorer lists the workspace': `__lg.waitFor(() => __lg.treeItem('README.md'))`,
  'directories expand': `(async () => {
    __lg.clickTree('src')
    return __lg.waitFor(() => __lg.treeItem('src/app.ts'))
  })()`,
  'files open in the editor': `(async () => {
    __lg.clickTree('src/app.ts')
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
  'agent edits land on disk and wait for review': async (win, page) => {
    await say(win, page, 'touch hunks.txt a\\nb\\nc\\nd\\ne\\n')
    return page(`__lg.waitFor(() => document.querySelector('[data-testid="changes-bar"]')
      && window.lookingglass.review.list().then((l) => l.some((e) => e.path === 'hunks.txt' && e.status === 'added')), 10000)`)
  },
  'keep all accepts every change': `(async () => {
    __lg.click('[data-testid="accept-all"]')
    return __lg.waitFor(() => !document.querySelector('[data-testid="changes-bar"]'))
  })()`,
  'per-hunk undo and keep': async (win, page) => {
    await say(win, page, 'write hunks.txt A\\nb\\nc\\nd\\nE\\n')
    return page(`(async () => {
      const read = () => window.lookingglass.fs.readFile('hunks.txt').then((f) => f.contents)
      await __lg.waitFor(() => document.querySelector('[data-testid="changes-bar"]'), 10000)
      __lg.click('[data-testid="changes-bar"] button')
      await __lg.waitFor(() => document.querySelector('[data-testid="change-entry"][data-path="hunks.txt"]'))
      __lg.click('[data-testid="change-entry"][data-path="hunks.txt"]')
      const hunks = () => document.querySelectorAll('[data-testid="review-view"] [data-testid="hunk-actions"]')
      if (!await __lg.waitFor(() => hunks().length === 2)) return console.log('hunks=' + hunks().length) || false
      hunks()[0].querySelector('[data-testid="hunk-reject"]').click()
      if (!await __lg.waitFor(async () => (await read()) === 'a\\nb\\nc\\nd\\nE\\n' && hunks().length === 1)) return false
      hunks()[0].querySelector('[data-testid="hunk-accept"]').click()
      return __lg.waitFor(async () => !document.querySelector('[data-testid="changes-bar"]') && (await read()) === 'a\\nb\\nc\\nd\\nE\\n')
    })()`)
  },
  'restore puts files back to before a message': async (win, page) => {
    await say(win, page, 'write README.md replaced by agent')
    return page(`(async () => {
      const read = () => window.lookingglass.fs.readFile('README.md').then((f) => f.contents)
      await __lg.waitFor(async () => (await read()) === 'replaced by agent', 10000)
      await __lg.waitFor(() => document.querySelector('[data-testid="chat"][data-busy="false"]'))
      window.confirm = () => true
      ;[...document.querySelectorAll('[data-testid="restore-checkpoint"]')].at(-1).click()
      return __lg.waitFor(async () => (await read()) === '# Smoke fixture\\n', 10000)
    })()`)
  },
  'agent commands run in a visible terminal': async (win, page) => {
    await say(win, page, 'run echo agent-$((1+1))')
    return page(`__lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
      .some((m) => m.textContent.includes('Exit 0. Output: agent-2'))
      && document.body.textContent.includes('Fake agent (testing): echo'), 15000)`)
  },
  '@-mentions attach files': async (win, page) => {
    await page(`__lg.waitFor(() => document.querySelector('[data-testid="chat"][data-busy="false"] [data-testid="composer"]:not(:disabled)'))
      .then(() => document.querySelector('[data-testid="composer"]').focus())`)
    win.webContents.insertText('@app')
    const found = await page(
      `__lg.waitFor(() => document.querySelector('[data-testid="mention-option"][data-label="src/app.ts"]'))`,
    )
    if (!found) return false
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await page(`__lg.waitFor(() => document.querySelector('[data-testid="attachment"]'))`)
    win.webContents.insertText('what is this')
    await page(`__lg.click('[data-testid="send"]')`)
    return page(`__lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
      .some((m) => m.textContent.includes('what is this @app.ts')), 10000)`)
  },
  'review tab shows the diff with hunk actions': async (win, page) => {
    await say(
      win,
      page,
      'write src/app.ts export const greeting = "hi"\\nconsole.log(greeting)\\nconsole.log("done")\\n',
    )
    return page(`(async () => {
      await __lg.waitFor(() => document.querySelector('[data-testid="changes-bar"]'), 10000)
      if (!document.querySelector('[data-testid="change-entry"]')) __lg.click('[data-testid="changes-bar"] button')
      await __lg.waitFor(() => document.querySelector('[data-testid="change-entry"][data-path="src/app.ts"]'))
      __lg.click('[data-testid="change-entry"][data-path="src/app.ts"]')
      return __lg.waitFor(() => {
        const view = document.querySelector('[data-testid="review-view"][data-path="src/app.ts"]')
        return view && __lg.deepText(view).includes('console.log("done")') && view.querySelectorAll('[data-testid="hunk-actions"]').length >= 1
      }, 10000)
    })()`)
  },
  'dev server URL in the terminal opens a browser tab': async (win, page) => {
    const site = process.env['LOOKINGGLASS_SMOKE_SITE']!
    const id = await page(`document.querySelector('[data-testid="terminal"]')?.dataset.terminalId`)
    await page(
      `window.lookingglass.terminal.write(${JSON.stringify(id)}, ${JSON.stringify(`echo "  Local: ${site}"\r`)})`,
    )
    return page(`(async () => {
      await __lg.waitFor(() => document.querySelector('[data-testid="open-detected-url"]'), 10000)
      __lg.click('[data-testid="open-detected-url"]')
      return __lg.waitFor(() => [...document.querySelectorAll('[data-testid="editor-tab"]')].some((t) => t.textContent.includes('Smoke site')), 15000)
    })()`)
  },
  'browser console captures errors and failed requests': `__lg.waitFor(() => {
    const n = Number(document.querySelector('[data-testid="console-errors"]')?.textContent.replace(/\\D/g, ''))
    return n >= 2
  }, 10000)`,
  'element picker collects element context': async (win, page) => {
    const contents = browserContents()
    if (!contents) return false
    await page(`__lg.click('[data-testid="picker-toggle"]')`)
    await new Promise((r) => setTimeout(r, 300))
    const point = (await contents.executeJavaScript(
      `(() => { const r = document.querySelector('[data-testid="cta"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`,
    )) as { x: number; y: number }
    contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await new Promise((r) => setTimeout(r, 100))
    contents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    const ok = await page(
      `__lg.waitFor(() => document.querySelector('[data-testid="picked-label"]')?.textContent.includes('<button.cta>'), 10000)`,
    )
    const first = browser.selection()[0]
    const picked = first?.kind === 'element' ? first : undefined
    console.log(
      `[smoke]      picked ${picked?.selector} rules=${JSON.stringify(picked?.rules.map((r) => r.source))} sources=${JSON.stringify(picked?.sources)}`,
    )
    return (
      ok &&
      picked?.rules.some((r) => r.source?.startsWith('site/styles.css')) &&
      picked.screenshot &&
      picked.sources.length > 0
    )
  },
  'asking about an element sends it to the agent': async (win, page) => {
    await page(`document.querySelector('[data-testid="ask-element"]').focus()`)
    win.webContents.insertText('why is this blue')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    return page(`__lg.waitFor(() => [...document.querySelectorAll('[data-testid="agent-message"]')]
      .some((m) => m.textContent.includes('why is this blue') && m.textContent.includes('[data-testid')), 10000)`)
  },
  'agents can drive the browser through MCP tools': async (_win, page) => {
    const handle = editorMcp()
    if (!handle) return false
    const client = new Client({ name: 'smoke', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: Object.fromEntries(handle.headers.map((h) => [h.name, h.value])) },
      }),
    )
    try {
      const toolText = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
        const result = (await client.callTool({ name, arguments: args })) as {
          content: Array<{ type: string; text?: string }>
        }
        return result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      }
      const tools = (await client.listTools()).tools.map((t) => t.name)
      if (!tools.includes('browser_snapshot') || !tools.includes('get_open_editors')) return false
      const snapshot = await toolText('browser_snapshot')
      const ref = /button "Get started" \[ref=(\d+)\]/.exec(snapshot)?.[1]
      if (!ref) return console.log(snapshot.slice(0, 800)) ?? false
      const banner = page(`__lg.waitFor(() => document.querySelector('[data-testid="agent-banner"]'), 5000)`)
      await toolText('browser_click', { ref: Number(ref) })
      const contents = browserContents()
      const clicked = await new Promise<boolean>((resolve) => {
        const end = Date.now() + 5000
        const poll = (): void => {
          if (contents?.getTitle() === 'clicked') return resolve(true)
          if (Date.now() > end) return resolve(false)
          setTimeout(poll, 100)
        }
        poll()
      })
      const selection = await toolText('browser_get_selection')
      const errors = await toolText('browser_console', { errorsOnly: true })
      return (
        clicked && (await banner) && selection.includes('Selector:') && errors.includes('smoke page error')
      )
    } finally {
      await client.close()
    }
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
  'Claude Code edits are put up for review': async (win, page) => {
    await say(
      win,
      page,
      'Create a file named probe.txt containing exactly the text ok, then run the shell command `cat probe.txt`. Do nothing else.',
    )
    // Approve whatever it asks for until the turn ends.
    return page(`(async () => {
      const end = Date.now() + 150000
      while (Date.now() < end) {
        const allow = document.querySelector('[data-testid="permission-option"][data-option-id]')
        const options = [...document.querySelectorAll('[data-testid="permission-option"]')]
        const pick = options.find((o) => /allow|yes|proceed/i.test(o.textContent) && !/always/i.test(o.textContent)) ?? allow
        if (pick) pick.click()
        if (document.querySelector('[data-testid="chat"][data-busy="false"]')) break
        await new Promise((r) => setTimeout(r, 300))
      }
      const list = await window.lookingglass.review.list()
      const disk = await window.lookingglass.fs.readFile('probe.txt').then((f) => f.contents, () => null)
      console.log('claude review=' + JSON.stringify(list) + ' disk=' + JSON.stringify(disk)
        + ' agentTerminal=' + document.body.textContent.includes('Claude Code: '))
      return list.some((e) => e.path === 'probe.txt') && disk?.trim() === 'ok'
    })()`)
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

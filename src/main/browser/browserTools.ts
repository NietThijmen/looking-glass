import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { describePicked } from '@lookingglass/shared/browser'
import type { BrowserService } from './BrowserService'
import type { Cdp } from './cdp'

export interface BrowserToolDeps {
  browser: BrowserService
  /** Ask the user to approve a risky action. Resolves true when allowed. */
  confirm(message: string, detail: string): Promise<boolean>
  /** Open a new browser tab in the editor. */
  openTab(url: string): string
  /** The workspace's configured preview URL (`.lookingglass/settings.json`), treated like localhost. */
  previewUrl(): Promise<string | null>
  /** Origins the user allowed agents to interact with this app session. */
  allowedOrigins: Set<string>
}

const MAX_SNAPSHOT_LINES = 1500

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const image = (data: string, caption: string) => ({
  content: [
    { type: 'image' as const, data, mimeType: 'image/png' },
    { type: 'text' as const, text: caption },
  ],
})

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

function origin(url: string): string | null {
  try {
    return new URL(url.includes('://') ? url : `http://${url}`).origin
  } catch {
    return null
  }
}

export function isLocal(url: string): boolean {
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`)
    return LOCAL_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.localhost')
  } catch {
    return false
  }
}

/** Pages agents may use without asking: localhost and the configured preview URL. */
async function isTrusted(deps: BrowserToolDeps, url: string): Promise<boolean> {
  if (isLocal(url) || url === 'about:blank') return true
  const preview = await deps.previewUrl()
  return preview !== null && origin(preview) === origin(url)
}

/**
 * Interacting with a page outside localhost acts with the user's cookies, so
 * the first interaction per origin asks. Returns an error text when declined.
 */
async function interactionAllowed(deps: BrowserToolDeps, url: string): Promise<string | null> {
  const o = origin(url)
  if ((await isTrusted(deps, url)) || (o && deps.allowedOrigins.has(o))) return null
  if (
    !(await deps.confirm(
      'Let the agent interact with this page?',
      `${url}\n\nThe agent can click and type as you, with your cookies for this site. Allowing applies to the whole site until Lookingglass restarts.`,
    ))
  )
    return 'The user declined to let the agent interact with this page.'
  if (o) deps.allowedOrigins.add(o)
  return null
}

interface AxNode {
  nodeId: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: unknown }
  childIds?: string[]
  backendDOMNodeId?: number
}

/** Accessibility tree as indented text with refs the action tools accept. */
async function snapshot(cdp: Cdp): Promise<string> {
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree')
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const lines: string[] = []
  const skip = new Set(['none', 'generic', 'InlineTextBox', 'LineBreak'])
  const walk = (node: AxNode, depth: number): void => {
    if (lines.length >= MAX_SNAPSHOT_LINES) return
    const role = node.role?.value ?? ''
    const name = node.name?.value ?? ''
    const shown = !node.ignored && !(skip.has(role) && !name) && !(role === 'StaticText' && !name.trim())
    if (shown) {
      const value =
        node.value?.value !== undefined && node.value.value !== ''
          ? ` value=${JSON.stringify(node.value.value)}`
          : ''
      const ref = node.backendDOMNodeId ? ` [ref=${node.backendDOMNodeId}]` : ''
      lines.push(`${'  '.repeat(depth)}- ${role}${name ? ` "${name.slice(0, 120)}"` : ''}${value}${ref}`)
    }
    for (const child of node.childIds ?? []) {
      const next = byId.get(child)
      if (next) walk(next, shown ? depth + 1 : depth)
    }
  }
  const root = nodes[0]
  if (root) walk(root, 0)
  if (lines.length >= MAX_SNAPSHOT_LINES) lines.push('… (truncated)')
  return lines.join('\n')
}

async function center(cdp: Cdp, ref: number): Promise<{ x: number; y: number }> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref }).catch(() => undefined)
  const { quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId: ref })
  const q = quads[0]
  if (!q) throw new Error(`Element ref=${ref} is not visible`)
  return { x: (q[0]! + q[2]! + q[4]! + q[6]!) / 4, y: (q[1]! + q[3]! + q[5]! + q[7]!) / 4 }
}

async function key(cdp: Cdp, name: string): Promise<void> {
  const special: Record<string, { code: string; keyCode: number; text?: string }> = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  }
  const k = special[name] ?? {
    code: name,
    keyCode: name.toUpperCase().charCodeAt(0),
    text: name.length === 1 ? name : undefined,
  }
  const base = {
    key: name,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    ...(k.text ? { text: k.text } : {}),
  }
  await cdp.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

const tabParam = {
  tab: z
    .string()
    .optional()
    .describe('Browser tab id from browser_list_tabs; defaults to the tab the user last looked at'),
}
const refParam = z.number().int().describe('Element ref from browser_snapshot')

/**
 * `browser_*` tools on the built-in MCP server, so any ACP agent can look at and
 * drive the user's browser tab. Reads are free. Navigating away from localhost
 * (or the configured preview URL) asks, interacting with such a page asks once
 * per site, and running JavaScript always asks.
 */
export function registerBrowserTools(server: McpServer, deps: BrowserToolDeps): void {
  const { browser } = deps

  server.registerTool(
    'browser_list_tabs',
    {
      description: 'Browser tabs open in the Lookingglass editor, with their URL and title.',
      inputSchema: {},
    },
    async () => {
      const tabs = browser.tabs()
      return text(
        tabs.length
          ? tabs.map((t) => `${t.tabId}: ${t.title || '(untitled)'} — ${t.url}`).join('\n')
          : 'No browser tabs are open.',
      )
    },
  )

  server.registerTool(
    'browser_get_selection',
    {
      description:
        'The element(s) or page region(s) the user picked with the element picker: selector, HTML, matched CSS with source files, computed styles, likely source file, and screenshots.',
      inputSchema: {},
    },
    async () => {
      const picked = browser.selection()
      if (!picked.length) return text('The user has not picked an element.')
      const content: Content[] = []
      picked.forEach((item, i) => {
        const heading = picked.length > 1 ? `Selection ${i + 1} of ${picked.length}\n` : ''
        content.push({ type: 'text', text: heading + describePicked(item) })
        if (item.screenshot) content.push({ type: 'image', data: item.screenshot, mimeType: 'image/png' })
      })
      return { content }
    },
  )

  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Accessibility tree of the page as text. Each element has a [ref=N] you can pass to browser_click, browser_type, browser_hover and browser_screenshot. Prefer this over screenshots for finding things.',
      inputSchema: tabParam,
    },
    async ({ tab }) => {
      const t = browser.agentTab(tab)
      const { result } = await t.cdp.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      })
      return text(`URL: ${result.value}\n${await snapshot(t.cdp)}`)
    },
  )

  server.registerTool(
    'browser_screenshot',
    {
      description:
        'Screenshot of the visible page, the whole scrollable page (fullPage), or one element when ref is given.',
      inputSchema: { ...tabParam, ref: refParam.optional(), fullPage: z.boolean().optional() },
    },
    async ({ tab, ref, fullPage }) => {
      const t = browser.agentTab(tab)
      if (ref === undefined)
        return image(await browser.screenshot(t.id, fullPage), fullPage ? 'Full page' : 'Visible viewport')
      await t.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref }).catch(() => undefined)
      const { model } = await t.cdp.send('DOM.getBoxModel', { backendNodeId: ref })
      const xs = [model.border[0], model.border[2], model.border[4], model.border[6]] as number[]
      const ys = [model.border[1], model.border[3], model.border[5], model.border[7]] as number[]
      const { cssVisualViewport: vp } = await t.cdp.send('Page.getLayoutMetrics')
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const { data } = await t.cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: x + vp.pageX,
          y: y + vp.pageY,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
          scale: 1,
        },
      })
      return image(data, `Element ref=${ref}`)
    },
  )

  server.registerTool(
    'browser_console',
    {
      description: 'Recent console messages, uncaught exceptions and failed network requests from the page.',
      inputSchema: { ...tabParam, errorsOnly: z.boolean().optional() },
    },
    async ({ tab, errorsOnly }) => {
      const t = browser.agentTab(tab)
      const entries = browser
        .consoleEntries(t.id)
        .filter((e) => !errorsOnly || e.level === 'error')
        .slice(-100)
      if (!entries.length) return text('No console output.')
      return text(
        entries
          .map(
            (e) =>
              `[${e.level}/${e.source}] ${e.text}${e.url ? ` (${e.url}${e.line ? `:${e.line}` : ''})` : ''}`,
          )
          .join('\n'),
      )
    },
  )

  server.registerTool(
    'browser_network_errors',
    {
      description: 'Failed network requests (HTTP 4xx/5xx, connection errors) from the page.',
      inputSchema: tabParam,
    },
    async ({ tab }) => {
      const t = browser.agentTab(tab)
      const entries = browser
        .consoleEntries(t.id)
        .filter((e) => e.source === 'network')
        .slice(-100)
      if (!entries.length) return text('No failed requests.')
      return text(entries.map((e) => `${e.text}${e.url ? ` ${e.url}` : ''}`).join('\n'))
    },
  )

  server.registerTool(
    'browser_navigate',
    {
      description:
        'Open a URL in the browser tab (or a new tab if none is open). Non-localhost URLs need the user to approve.',
      inputSchema: { ...tabParam, url: z.string() },
    },
    async ({ tab, url }) => {
      if (!(await isTrusted(deps, url)) && !(await deps.confirm('Let the agent open this page?', url))) {
        return text('The user declined to open that URL.')
      }
      if (!tab && !browser.tabs().length) {
        const id = deps.openTab(url)
        return text(`Opened ${url} in new tab ${id}`)
      }
      const t = browser.agentTab(tab)
      browser.navigate(t.id, url)
      return text(`Navigating ${t.id} to ${url}`)
    },
  )

  server.registerTool(
    'browser_click',
    { description: 'Click an element.', inputSchema: { ...tabParam, ref: refParam } },
    async ({ tab, ref }) => {
      const t = browser.agentTab(tab)
      const declined = await interactionAllowed(deps, t.url)
      if (declined) return text(declined)
      const { x, y } = await center(t.cdp, ref)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await t.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      }
      return text(`Clicked ref=${ref}`)
    },
  )

  server.registerTool(
    'browser_hover',
    { description: 'Move the mouse over an element.', inputSchema: { ...tabParam, ref: refParam } },
    async ({ tab, ref }) => {
      const t = browser.agentTab(tab)
      const declined = await interactionAllowed(deps, t.url)
      if (declined) return text(declined)
      const { x, y } = await center(t.cdp, ref)
      await t.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      return text(`Hovering ref=${ref}`)
    },
  )

  server.registerTool(
    'browser_type',
    {
      description: 'Focus an element and type text into it, optionally pressing Enter afterwards.',
      inputSchema: { ...tabParam, ref: refParam, text: z.string(), submit: z.boolean().optional() },
    },
    async ({ tab, ref, text: value, submit }) => {
      const t = browser.agentTab(tab)
      const declined = await interactionAllowed(deps, t.url)
      if (declined) return text(declined)
      await t.cdp.send('DOM.focus', { backendNodeId: ref })
      await t.cdp.send('Input.insertText', { text: value })
      if (submit) await key(t.cdp, 'Enter')
      return text(`Typed into ref=${ref}${submit ? ' and pressed Enter' : ''}`)
    },
  )

  server.registerTool(
    'browser_press_key',
    {
      description: 'Press a key (Enter, Tab, Escape, ArrowDown, a letter…).',
      inputSchema: { ...tabParam, key: z.string() },
    },
    async ({ tab, key: name }) => {
      const t = browser.agentTab(tab)
      const declined = await interactionAllowed(deps, t.url)
      if (declined) return text(declined)
      await key(t.cdp, name)
      return text(`Pressed ${name}`)
    },
  )

  server.registerTool(
    'browser_resize',
    {
      description: 'Emulate a viewport size (e.g. 390×844 for a phone). Pass width 0 to reset.',
      inputSchema: { ...tabParam, width: z.number().int().min(0), height: z.number().int().min(0) },
    },
    async ({ tab, width, height }) => {
      const t = browser.agentTab(tab)
      if (width === 0) await t.cdp.send('Emulation.clearDeviceMetricsOverride')
      else
        await t.cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 0,
          mobile: width < 600,
        })
      return text(width === 0 ? 'Viewport reset' : `Viewport ${width}×${height}`)
    },
  )

  server.registerTool(
    'browser_evaluate',
    {
      description:
        'Run a JavaScript expression in the page and return the result. The user must approve every call.',
      inputSchema: { ...tabParam, expression: z.string() },
    },
    async ({ tab, expression }) => {
      const t = browser.agentTab(tab)
      if (!(await deps.confirm('Let the agent run JavaScript in the page?', expression.slice(0, 500)))) {
        return text('The user declined to run that script.')
      }
      const { result, exceptionDetails } = await t.cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (exceptionDetails)
        return text(`Error: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
      return text(
        result.value === undefined
          ? String(result.description ?? 'undefined')
          : JSON.stringify(result.value, null, 2),
      )
    },
  )
}

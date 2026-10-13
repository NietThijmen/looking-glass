import { BrowserWindow, session, WebContentsView, type Session } from 'electron'
import type {
  BrowserBounds,
  BrowserTabState,
  ConsoleEntry,
  ConsoleLevel,
  Picked,
  PickedElement,
  PickedRegion,
  PickMode,
} from '../../shared/browser'
import { Cdp } from './cdp'
import { collectElement, type ContextDeps } from './elementContext'
import { REGION_CANCEL, REGION_SCRIPT, REGION_WORLD } from './regionScript'
import { StylesheetSources } from './stylesheetSources'

export const BROWSER_PARTITION = 'persist:lookingglass-browser'
const MAX_CONSOLE = 500
const AGENT_ACTIVE_MS = 4000

const HIGHLIGHT = {
  showInfo: true,
  showStyles: true,
  showAccessibilityInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.55 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.5 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.6 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.5 },
}

export interface BrowserEvents {
  state(state: BrowserTabState): void
  console(tabId: string, entry: ConsoleEntry): void
  picked(item: Picked, mode: PickMode): void
  opened(tabId: string, url: string): void
}

export type ElementSourceDeps = Pick<ContextDeps, 'toWorkspacePath' | 'search' | 'findFile'>

interface Tab {
  id: string
  view: WebContentsView
  cdp: Cdp
  console: ConsoleEntry[]
  sheets: StylesheetSources
  isolatedContext: number | null
  picking: boolean
  capturing: boolean
  /** Held while picking: Shift+click adds to the selection instead of replacing it. */
  shiftDown: boolean
  /** backendNodeId of the last picked element, for walking to its parent or child. */
  selected: number | null
  /** Elements left by walking to a parent, so walking back down returns to them. */
  walkedFrom: number[]
  selection: Picked[]
  agentUntil: number
  agentTimer: NodeJS.Timeout | undefined
  agentBlocked: boolean
  bounds: BrowserBounds | null
}

export function browserSession(): Session {
  return session.fromPartition(BROWSER_PARTITION)
}

/** Untrusted web content: deny every permission prompt (camera, mic, location, notifications…). */
export function hardenBrowserSession(): void {
  const ses = browserSession()
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
}

/**
 * Browser tabs: one WebContentsView each, in their own session partition, laid
 * over the area the renderer reserves for them. Owns the element picker,
 * console capture, and the CDP calls behind the agent browser tools.
 */
export class BrowserService {
  #tabs = new Map<string, Tab>()
  #nextId = 1
  #consoleId = 1
  /** Most recently shown tab: the default target for agent tools. */
  #lastActive: string | null = null

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly events: BrowserEvents,
    private readonly sources: ElementSourceDeps,
  ) {}

  create(url: string, fromAgent = false): string {
    const win = this.window()
    if (!win) throw new Error('No window')
    const id = `b${this.#nextId++}`
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    win.contentView.addChildView(view)

    const tab: Tab = {
      id,
      view,
      cdp: new Cdp(view.webContents),
      console: [],
      sheets: new StylesheetSources({
        fetchText: async (url) => {
          const response = await browserSession().fetch(url)
          if (!response.ok) throw new Error(`${response.status}`)
          return response.text()
        },
        toWorkspacePath: (pathOrUrl) => this.sources.toWorkspacePath(pathOrUrl),
      }),
      isolatedContext: null,
      picking: false,
      capturing: false,
      shiftDown: false,
      selected: null,
      walkedFrom: [],
      selection: [],
      agentUntil: 0,
      agentTimer: undefined,
      agentBlocked: false,
      bounds: null,
    }
    this.#tabs.set(id, tab)
    // Load only once CDP listens, so console output from the first load isn't missed. CDP
    // commands hang until the view has a renderer, so start one with about:blank first and
    // drop it from history once the real page is in.
    void view.webContents
      .loadURL('about:blank')
      .catch(() => undefined)
      .then(() => this.#wire(tab))
      .then(() => view.webContents.loadURL(normalizeUrl(url)))
      .then(
        () => view.webContents.navigationHistory.removeEntryAtIndex(0),
        () => undefined,
      )
    this.#lastActive = id
    if (fromAgent) this.events.opened(id, url)
    return id
  }

  close(tabId: string): void {
    const tab = this.#tabs.get(tabId)
    if (!tab) return
    this.#tabs.delete(tabId)
    clearTimeout(tab.agentTimer)
    this.window()?.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (this.#lastActive === tabId) this.#lastActive = [...this.#tabs.keys()].at(-1) ?? null
  }

  closeAll(): void {
    for (const id of [...this.#tabs.keys()]) this.close(id)
  }

  /** Position the view over the renderer's placeholder; null hides it. */
  setBounds(tabId: string, bounds: BrowserBounds | null): void {
    const tab = this.#tabs.get(tabId)
    if (!tab) return
    tab.bounds = bounds
    if (!bounds || bounds.width < 1 || bounds.height < 1) {
      tab.view.setVisible(false)
      return
    }
    // The renderer measures in CSS pixels; views are placed in window DIPs, which differ when the UI is zoomed.
    const zoom = this.window()?.webContents.getZoomFactor() ?? 1
    tab.view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    })
    tab.view.setVisible(true)
    this.#lastActive = tabId
  }

  navigate(tabId: string, url: string): void {
    void this.#tab(tabId)
      .view.webContents.loadURL(normalizeUrl(url))
      .catch(() => undefined)
  }

  back(tabId: string): void {
    this.#tab(tabId).view.webContents.navigationHistory.goBack()
  }

  forward(tabId: string): void {
    this.#tab(tabId).view.webContents.navigationHistory.goForward()
  }

  reload(tabId: string): void {
    this.#tab(tabId).view.webContents.reload()
  }

  openDevTools(tabId: string): void {
    this.#tab(tabId).view.webContents.openDevTools({ mode: 'detach' })
  }

  consoleEntries(tabId: string): ConsoleEntry[] {
    return this.#tab(tabId).console
  }

  clearConsole(tabId: string): void {
    this.#tab(tabId).console = []
  }

  async setPicking(tabId: string, picking: boolean): Promise<void> {
    const tab = this.#tab(tabId)
    tab.picking = picking
    await tab.cdp.send('Overlay.setInspectMode', {
      mode: picking ? 'searchForNode' : 'none',
      highlightConfig: HIGHLIGHT,
    })
    if (picking) tab.view.webContents.focus()
    this.#emitState(tab)
  }

  /**
   * Replace the last picked element with its parent or a child element. Going
   * down retraces earlier steps up; otherwise it takes the first child.
   */
  async walk(tabId: string, direction: 'parent' | 'child'): Promise<PickedElement | null> {
    const tab = this.#tab(tabId)
    const from = tab.selected
    if (from === null) return null
    const next = direction === 'child' ? await this.#walkedChild(tab, from) : null
    const target = next ?? (await this.#relative(tab, from, direction))
    if (target === null) return null
    if (direction === 'parent') tab.walkedFrom.push(from)
    else if (next === null) tab.walkedFrom = []
    const element = await this.#select(tab, target, 'replace-last')
    this.events.picked(element, 'replace-last')
    return element
  }

  /** Let the user drag a rectangle over the page and capture it. Resolves null when cancelled. */
  async captureRegion(tabId: string): Promise<PickedRegion | null> {
    const tab = this.#tab(tabId)
    if (tab.picking) await this.setPicking(tabId, false)
    if (tab.capturing) return null
    const wc = tab.view.webContents
    tab.capturing = true
    this.#emitState(tab)
    wc.focus()
    try {
      const rect = (await wc.executeJavaScriptInIsolatedWorld(
        REGION_WORLD,
        [{ code: REGION_SCRIPT }],
        true,
      )) as {
        x: number
        y: number
        width: number
        height: number
        scrollX: number
        scrollY: number
        viewport: { width: number; height: number }
      } | null
      if (!rect) return null
      const { data } = await tab.cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: rect.x + rect.scrollX,
          y: rect.y + rect.scrollY,
          width: rect.width,
          height: rect.height,
          scale: 1,
        },
      })
      const region: PickedRegion = {
        kind: 'region',
        tabId,
        pageUrl: wc.getURL(),
        pageTitle: wc.getTitle(),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        viewport: rect.viewport,
        screenshot: data,
      }
      const mode: PickMode = tab.shiftDown ? 'add' : 'replace'
      this.#remember(tab, region, mode)
      this.events.picked(region, mode)
      return region
    } finally {
      tab.capturing = false
      if (this.#tabs.has(tab.id)) this.#emitState(tab)
    }
  }

  /** Drop one picked item (by index), or the whole selection. */
  unpick(tabId: string, index?: number): void {
    const tab = this.#tabs.get(tabId)
    if (!tab) return
    if (index === undefined) tab.selection = []
    else tab.selection = tab.selection.filter((_, i) => i !== index)
    if (!tab.selection.some((p) => p.kind === 'element')) {
      tab.selected = null
      tab.walkedFrom = []
      void tab.cdp.send('Overlay.hideHighlight').catch(() => undefined)
    }
  }

  async screenshot(tabId: string, fullPage = false): Promise<string> {
    const { cdp } = this.#tab(tabId)
    if (!fullPage) return (await cdp.send('Page.captureScreenshot', { format: 'png' })).data
    const { cssContentSize: size } = await cdp.send('Page.getLayoutMetrics')
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 16000), scale: 1 },
    })
    return data
  }

  state(tabId: string): BrowserTabState {
    return this.#state(this.#tab(tabId))
  }

  // ---- for agent tools ----------------------------------------------------

  tabs(): BrowserTabState[] {
    return [...this.#tabs.values()].map((t) => this.#state(t))
  }

  /** The tab an agent tool should act on: the given one, else the last shown. */
  agentTab(tabId?: string): { id: string; cdp: Cdp; url: string } {
    const id = tabId ?? this.#lastActive
    const tab = id ? this.#tabs.get(id) : undefined
    if (!tab) throw new Error('No browser tab is open. Use browser_navigate to open one.')
    if (tab.agentBlocked) throw new Error('The user stopped agent control of this browser tab.')
    tab.agentUntil = Date.now() + AGENT_ACTIVE_MS
    this.#emitState(tab)
    clearTimeout(tab.agentTimer)
    tab.agentTimer = setTimeout(() => this.#emitState(tab), AGENT_ACTIVE_MS + 50)
    return { id: tab.id, cdp: tab.cdp, url: tab.view.webContents.getURL() }
  }

  setAgentBlocked(tabId: string, blocked: boolean): void {
    const tab = this.#tab(tabId)
    tab.agentBlocked = blocked
    if (blocked) tab.agentUntil = 0
    this.#emitState(tab)
  }

  /** What the user has picked in the tab they last looked at. */
  selection(): Picked[] {
    const id = this.#lastActive
    return (id && this.#tabs.get(id)?.selection) || []
  }

  // ---- internals ----------------------------------------------------------

  #tab(tabId: string): Tab {
    const tab = this.#tabs.get(tabId)
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`)
    return tab
  }

  #state(tab: Tab): BrowserTabState {
    const wc = tab.view.webContents
    return {
      tabId: tab.id,
      url: wc.isDestroyed() ? '' : wc.getURL(),
      title: wc.isDestroyed() ? '' : wc.getTitle(),
      loading: !wc.isDestroyed() && wc.isLoading(),
      canGoBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(),
      canGoForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
      picking: tab.picking,
      capturing: tab.capturing,
      agentActive: Date.now() < tab.agentUntil,
      agentBlocked: tab.agentBlocked,
    }
  }

  #emitState(tab: Tab): void {
    if (this.#tabs.has(tab.id)) this.events.state(this.#state(tab))
  }

  #pushConsole(tab: Tab, entry: Omit<ConsoleEntry, 'id' | 'time'>): void {
    const full: ConsoleEntry = { ...entry, id: this.#consoleId++, time: Date.now() }
    tab.console.push(full)
    if (tab.console.length > MAX_CONSOLE) tab.console.shift()
    this.events.console(tab.id, full)
  }

  #remember(tab: Tab, item: Picked, mode: PickMode): void {
    if (mode === 'add') tab.selection = [...tab.selection, item]
    else if (mode === 'replace-last' && tab.selection.length)
      tab.selection = [...tab.selection.slice(0, -1), item]
    else tab.selection = [item]
  }

  async #select(tab: Tab, backendNodeId: number, mode: PickMode): Promise<PickedElement> {
    tab.selected = backendNodeId
    await tab.cdp
      .send('Overlay.highlightNode', { highlightConfig: HIGHLIGHT, backendNodeId })
      .catch(() => undefined)
    const element = await collectElement(
      {
        cdp: tab.cdp,
        ...this.sources,
        ruleSource: (id, line, column) => tab.sheets.resolve(id, line, column),
        isolatedContext: () => this.#isolatedContext(tab),
      },
      tab.id,
      backendNodeId,
    )
    this.#remember(tab, element, mode)
    return element
  }

  /** The element we walked up from, if it is still a child of `from`. */
  async #walkedChild(tab: Tab, from: number): Promise<number | null> {
    const child = tab.walkedFrom.pop()
    if (child === undefined) return null
    const parent = await this.#relative(tab, child, 'parent').catch(() => null)
    if (parent === from) return child
    tab.walkedFrom = []
    return null
  }

  async #relative(tab: Tab, backendNodeId: number, direction: 'parent' | 'child'): Promise<number | null> {
    const { object } = await tab.cdp.send('DOM.resolveNode', { backendNodeId })
    const { result } = await tab.cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration:
        direction === 'parent'
          ? 'function () { return this.parentElement }'
          : 'function () { return this.firstElementChild }',
    })
    if (!result.objectId) return null
    const { node } = await tab.cdp.send('DOM.describeNode', { objectId: result.objectId })
    if (!node.backendNodeId || node.localName === 'html') return null
    return node.backendNodeId
  }

  async #isolatedContext(tab: Tab): Promise<number> {
    if (tab.isolatedContext !== null) return tab.isolatedContext
    const { frameTree } = await tab.cdp.send('Page.getFrameTree')
    const { executionContextId } = await tab.cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'lookingglass',
    })
    tab.isolatedContext = executionContextId
    return executionContextId
  }

  #wire(tab: Tab): Promise<unknown> {
    const wc = tab.view.webContents
    const emit = (): void => this.#emitState(tab)

    // Pages may not open windows; links meant for a new window open in this tab.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void wc.loadURL(url)
      return { action: 'deny' }
    })
    for (const event of [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ] as const) {
      wc.on(event as 'did-start-loading', emit)
    }
    wc.on('did-navigate', () => {
      tab.isolatedContext = null
      tab.sheets.clear()
      tab.selected = null
      tab.walkedFrom = []
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3)
        this.#pushConsole(tab, { level: 'error', source: 'network', text: `${description} (${code})`, url })
    })
    // Picking needs the view focused: Escape cancels, Shift adds to the selection, ⇧⌘C toggles.
    wc.on('before-input-event', (event, input) => {
      if (input.key === 'Shift') tab.shiftDown = input.type === 'keyDown'
      if (input.type !== 'keyDown') return
      if (input.key.toLowerCase() === 'c' && input.shift && (input.meta || input.control)) {
        event.preventDefault()
        void this.setPicking(tab.id, !tab.picking)
      } else if (input.key === 'Escape' && tab.picking) {
        event.preventDefault()
        void this.setPicking(tab.id, false)
      } else if (input.key === 'Escape' && tab.capturing) {
        event.preventDefault()
        void wc
          .executeJavaScriptInIsolatedWorld(REGION_WORLD, [{ code: REGION_CANCEL }])
          .catch(() => undefined)
      }
    })

    try {
      tab.cdp.attach()
    } catch (error) {
      console.error('[browser] could not attach debugger', error)
      return Promise.resolve()
    }
    const { cdp } = tab
    const ready = Promise.all([
      cdp.send('Page.enable'),
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Overlay.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Network.enable'),
    ]).catch((error: unknown) => console.error('[browser] CDP setup failed', error))

    cdp.on('CSS.styleSheetAdded', ({ header }) => {
      tab.sheets.add(header.styleSheetId, {
        sourceURL: header.sourceURL ?? '',
        ...(header.sourceMapURL ? { sourceMapURL: header.sourceMapURL } : {}),
        ...(header.isInline ? { inlineStartLine: header.startLine } : {}),
      })
      if (header.ownerNode && header.isInline) {
        // Vite dev serves CSS as <style data-vite-dev-id="/abs/path/to/App.css">.
        void cdp
          .send('DOM.describeNode', { backendNodeId: header.ownerNode })
          .then(({ node }) => {
            const attrs: string[] = node.attributes ?? []
            const i = attrs.indexOf('data-vite-dev-id')
            if (i >= 0 && attrs[i + 1]) tab.sheets.update(header.styleSheetId, { viteId: attrs[i + 1] })
          })
          .catch(() => undefined)
      }
    })
    cdp.on('Runtime.executionContextsCleared', () => {
      tab.isolatedContext = null
    })
    cdp.on('Overlay.inspectNodeRequested', ({ backendNodeId }) => {
      void (async () => {
        // Shift+click keeps picking and adds to the selection.
        const mode: PickMode = tab.shiftDown ? 'add' : 'replace'
        if (mode === 'replace') await this.setPicking(tab.id, false)
        tab.walkedFrom = []
        try {
          this.events.picked(await this.#select(tab, backendNodeId, mode), mode)
        } catch (error) {
          console.error('[browser] collecting element failed', error)
        }
      })()
    })
    cdp.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
      const level: ConsoleLevel =
        type === 'error' || type === 'assert'
          ? 'error'
          : type === 'warning'
            ? 'warning'
            : type === 'info'
              ? 'info'
              : 'log'
      const text = (args ?? [])
        .map((a: { value?: unknown; description?: string; type: string }) =>
          a.value !== undefined
            ? typeof a.value === 'string'
              ? a.value
              : JSON.stringify(a.value)
            : (a.description ?? a.type),
        )
        .join(' ')
      const frame = stackTrace?.callFrames?.[0]
      this.#pushConsole(tab, {
        level,
        source: 'console',
        text,
        ...(frame ? { url: frame.url, line: frame.lineNumber + 1 } : {}),
      })
    })
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
      this.#pushConsole(tab, {
        level: 'error',
        source: 'exception',
        text: d.exception?.description ?? d.text,
        ...(d.url ? { url: d.url, line: d.lineNumber + 1 } : {}),
      })
    })
    cdp.on('Network.responseReceived', ({ response, type }) => {
      if (response.status >= 400) {
        this.#pushConsole(tab, {
          level: 'error',
          source: 'network',
          text: `${response.status} ${response.statusText} (${type})`,
          url: response.url,
        })
      }
    })
    cdp.on('Network.loadingFailed', ({ errorText, canceled, type }) => {
      if (!canceled)
        this.#pushConsole(tab, { level: 'error', source: 'network', text: `${errorText} (${type})` })
    })
    return ready
  }
}

/** Bare hosts become URLs; localhost defaults to http. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^localhost:\d/i.test(trimmed)) return trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

import type { PickedElement, SourceHint } from '../../shared/browser'
import type { Cdp } from './cdp'

const MAX_HTML = 4000
const MAX_TEXT = 200
const SCREENSHOT_PADDING = 16

/** Computed properties worth sending; values that are almost always defaults are dropped. */
const COMPUTED = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'box-sizing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-radius',
  'box-shadow',
  'opacity',
  'z-index',
  'overflow-x',
  'overflow-y',
  'transform',
  'vertical-align',
]
const BORING = new Set([
  'none',
  'normal',
  'auto',
  '0px',
  'static',
  'rgba(0, 0, 0, 0)',
  'visible',
  'baseline',
  '0',
  '1',
])

/** Runs on the element in an isolated world: selector, text and geometry. */
const DESCRIBE = `function () {
  const el = this
  const esc = (s) => CSS.escape(s)
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } }
  let selector = ''
  if (el.id && unique('#' + esc(el.id))) selector = '#' + esc(el.id)
  else {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.localName
      const testid = node.getAttribute('data-testid')
      if (node.id && unique('#' + esc(node.id))) { parts.unshift('#' + esc(node.id)); break }
      if (testid) part += '[data-testid="' + testid.replace(/"/g, '\\\\"') + '"]'
      else {
        const classes = [...node.classList].filter((c) => c.length > 2 && !/\\d{3,}/.test(c)).slice(0, 2)
        if (classes.length) part += '.' + classes.map(esc).join('.')
        const parent = node.parentElement
        if (parent) {
          const same = [...parent.children].filter((c) => c.localName === node.localName)
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
        }
      }
      parts.unshift(part)
      if (unique(parts.join(' > '))) break
      node = node.parentElement
    }
    selector = parts.join(' > ')
  }
  const outline = (n) =>
    n.localName + (n.id ? '#' + n.id : '') + [...n.classList].slice(0, 2).map((c) => '.' + c).join('')
  const ancestors = []
  for (let p = el.parentElement; p && p !== document.documentElement && ancestors.length < 8; p = p.parentElement)
    ancestors.unshift(outline(p))
  // Fit the markup in the budget by collapsing ever shallower subtrees.
  let html = el.outerHTML
  for (let depth = 4; depth >= 0 && html.length > ${MAX_HTML}; depth--) {
    const clone = el.cloneNode(true)
    const collapse = (node, d) => {
      for (const child of [...node.children]) {
        if (d < depth) collapse(child, d + 1)
        else if (child.children.length)
          child.replaceChildren(document.createComment(' ' + child.querySelectorAll('*').length + ' elements collapsed '))
      }
    }
    collapse(clone, 0)
    html = clone.outerHTML
  }
  const r = el.getBoundingClientRect()
  return {
    html,
    ancestors,
    selector,
    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' '),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    scroll: { x: window.scrollX, y: window.scrollY },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}`

/**
 * Runs in the page's main world (framework metadata lives on JS properties that
 * isolated worlds can't see). Read-only.
 */
const SOURCE_HINTS = `function () {
  const out = {}
  const lg = this.closest && this.closest('[data-lg-source]')
  if (lg) out.lgSource = lg.getAttribute('data-lg-source')
  const fiberKey = Object.keys(this).find((k) => k.startsWith('__reactFiber$'))
  if (fiberKey) {
    let fiber = this[fiberKey]
    let name
    for (let i = 0; fiber && i < 50; i++, fiber = fiber.return) {
      if (!name && typeof fiber.type === 'function') name = fiber.type.displayName || fiber.type.name
      if (fiber._debugSource) { out.react = { file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber, name }; break }
    }
    if (!out.react && name) out.react = { name }
  }
  let vue = this.__vueParentComponent
  if (vue && vue.type) out.vue = { file: vue.type.__file, name: vue.type.__name || vue.type.name }
  for (let n = this; n && !out.svelte; n = n.parentElement) {
    if (n.__svelte_meta && n.__svelte_meta.loc) out.svelte = { file: n.__svelte_meta.loc.file, line: n.__svelte_meta.loc.line + 1 }
  }
  const ng = window.ng
  if (ng && typeof ng.getComponent === 'function') {
    for (let n = this; n && !out.angular; n = n.parentElement) {
      try {
        const c = ng.getComponent(n)
        if (c) out.angular = { name: c.constructor && c.constructor.name }
      } catch {}
    }
  }
  return out
}`

export interface ContextDeps {
  cdp: Cdp
  /** Map a URL or file path from the page to a workspace path, if it is one. */
  toWorkspacePath(pathOrUrl: string): Promise<string | null>
  /** Fallback: find likely source files by searching the workspace. */
  search(needle: string): Promise<string[]>
  /** A workspace file whose path ends with `relative` (dev servers whose root is a subfolder). */
  findFile(relative: string): Promise<string | null>
  /**
   * Where a CSS rule really lives: through the stylesheet's source map or the
   * dev server's metadata when there is one. `path` is set for workspace files.
   */
  ruleSource(
    styleSheetId: string,
    line: number,
    column: number,
  ): Promise<{ path: string | null; line: number; display: string } | undefined>
  isolatedContext(): Promise<number>
}

interface Described {
  html: string
  ancestors: string[]
  selector: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
  scroll: { x: number; y: number }
  viewport: { width: number; height: number }
}

export async function callOnNode<T>(
  cdp: Cdp,
  backendNodeId: number,
  fn: string,
  executionContextId?: number,
): Promise<T> {
  const { object } = await cdp.send('DOM.resolveNode', {
    backendNodeId,
    ...(executionContextId ? { executionContextId } : {}),
  })
  const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: fn,
    returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Script failed')
  return result.value as T
}

interface PageMeta {
  lgSource?: string
  react?: { file?: string; line?: number; name?: string }
  vue?: { file?: string; name?: string }
  svelte?: { file?: string; line?: number }
  angular?: { name?: string }
}

function framework(meta: PageMeta): PickedElement['framework'] {
  const pick = (name: NonNullable<PickedElement['framework']>['name'], component?: string) => ({
    name,
    ...(component ? { component } : {}),
  })
  if (meta.react) return pick('react', meta.react.name)
  if (meta.vue) return pick('vue', meta.vue.name)
  if (meta.svelte) return pick('svelte')
  if (meta.angular) return pick('angular', meta.angular.name)
  return undefined
}

async function sourceHints(
  deps: ContextDeps,
  meta: PageMeta,
  described: Described,
  classes: string[],
  styleFiles: SourceHint[],
  id?: string,
): Promise<SourceHint[]> {
  const hints: SourceHint[] = []
  const add = async (
    raw: string | undefined,
    line: number | undefined,
    via: SourceHint['via'],
    component?: string,
  ) => {
    if (!raw) return
    const path =
      (await deps.toWorkspacePath(raw)) ?? (via === 'data-lg-source' ? await deps.findFile(raw) : null)
    if (path && !hints.some((h) => h.path === path)) {
      hints.push({ path, ...(line ? { line } : {}), via, ...(component ? { component } : {}) })
    }
  }

  if (meta.lgSource) {
    const [file, line] = meta.lgSource.split(':')
    await add(file, line ? Number(line) : undefined, 'data-lg-source')
  }
  await add(meta.react?.file, meta.react?.line, 'react', meta.react?.name)
  await add(meta.vue?.file, undefined, 'vue', meta.vue?.name)
  await add(meta.svelte?.file, meta.svelte?.line, 'svelte')

  if (!hints.length) {
    // Guess from distinctive strings that are likely to appear in the source.
    const testid = /data-testid="([^"]+)"/.exec(described.html)?.[1]
    const needles = [
      testid,
      id,
      ...classes.filter((c) => c.length > 4),
      described.text.length > 3 && described.text.length < 40 ? described.text : undefined,
    ]
    for (const needle of needles) {
      if (!needle) continue
      for (const path of await deps.search(needle)) {
        // Stylesheets already come with the matched CSS rules; look for markup instead.
        if (/\.(css|scss|sass|less|styl)$/.test(path)) continue
        if (!hints.some((h) => h.path === path)) hints.push({ path, via: 'search' })
      }
      if (hints.length >= 3) break
    }
  }
  for (const hint of styleFiles) if (!hints.some((h) => h.path === hint.path)) hints.push(hint)
  return hints
}

/** Everything we tell an agent about an element the user picked. */
export async function collectElement(
  deps: ContextDeps,
  tabId: string,
  backendNodeId: number,
): Promise<PickedElement> {
  const { cdp } = deps
  const contextId = await deps.isolatedContext()
  const described = await callOnNode<Described>(cdp, backendNodeId, DESCRIBE, contextId)
  const { node } = await cdp.send('DOM.describeNode', { backendNodeId })
  const attributes: Record<string, string> = {}
  for (let i = 0; i + 1 < (node.attributes?.length ?? 0); i += 2)
    attributes[node.attributes[i]] = node.attributes[i + 1]

  let html = described.html
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML) + '\n<!-- … truncated -->'

  await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: [backendNodeId],
  })
  const nodeId = nodeIds[0]

  const rules: PickedElement['rules'] = []
  const styleFiles: SourceHint[] = []
  const computed: Record<string, string> = {}
  if (nodeId) {
    try {
      const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
      for (const match of matched.matchedCSSRules ?? []) {
        const rule = match.rule
        if (rule.origin === 'user-agent') continue
        const range = rule.selectorList?.selectors?.[0]?.range ?? rule.style?.range
        const where =
          rule.styleSheetId && range
            ? await deps.ruleSource(rule.styleSheetId, range.startLine, range.startColumn)
            : undefined
        const source = where?.display
        if (where?.path && !styleFiles.some((f) => f.path === where.path))
          styleFiles.push({ path: where.path, line: where.line, via: 'stylesheet' })
        rules.push({
          selector: rule.selectorList?.text ?? '',
          css: (rule.style?.cssText ?? '').trim(),
          ...(source ? { source } : {}),
        })
      }
      if (matched.inlineStyle?.cssText?.trim())
        rules.unshift({ selector: 'style attribute', css: matched.inlineStyle.cssText.trim() })
      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId })
      const wanted = new Set(COMPUTED)
      for (const { name, value } of computedStyle) {
        if (wanted.has(name) && !BORING.has(value)) computed[name] = value
      }
    } catch {
      // CSS domain unavailable for this node (e.g. SVG in some cases); send what we have.
    }
  }

  let role: string | undefined
  let accessibleName: string | undefined
  try {
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    })
    role = nodes[0]?.role?.value
    accessibleName = nodes[0]?.name?.value || undefined
  } catch {
    // Accessibility tree unavailable; fine.
  }

  let screenshot: string | undefined
  const { rect, scroll } = described
  if (rect.width > 0 && rect.height > 0) {
    try {
      const pad = SCREENSHOT_PADDING
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: Math.max(0, rect.x + scroll.x - pad),
          y: Math.max(0, rect.y + scroll.y - pad),
          width: Math.min(rect.width + pad * 2, 2000),
          height: Math.min(rect.height + pad * 2, 2000),
          scale: 1,
        },
      })
      screenshot = result.data
    } catch {
      // Screenshots fail on some pages (e.g. zero-size frames).
    }
  }

  const { url: pageUrl, title: pageTitle } = await cdp
    .send('Runtime.evaluate', {
      expression: '({ url: location.href, title: document.title })',
      returnByValue: true,
    })
    .then((r) => r.result.value as { url: string; title: string })
    .catch(() => ({ url: '', title: '' }))

  let meta: PageMeta = {}
  try {
    meta = await callOnNode(cdp, backendNodeId, SOURCE_HINTS)
  } catch {
    // Pages with no JS access (e.g. about:blank) just get no hints.
  }
  const classes = (attributes['class'] ?? '').split(/\s+/).filter(Boolean)
  const detected = framework(meta)
  return {
    kind: 'element',
    tabId,
    pageUrl,
    pageTitle,
    selector: described.selector,
    tag: node.localName ?? node.nodeName?.toLowerCase() ?? '',
    ...(attributes['id'] ? { id: attributes['id'] } : {}),
    classes,
    text: described.text.slice(0, MAX_TEXT),
    ...(role ? { role } : {}),
    ...(accessibleName ? { accessibleName } : {}),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    viewport: described.viewport,
    html,
    ancestors: described.ancestors,
    rules,
    computed,
    ...(screenshot ? { screenshot } : {}),
    ...(detected ? { framework: detected } : {}),
    sources: await sourceHints(deps, meta, described, classes, styleFiles.slice(0, 3), attributes['id']),
  }
}

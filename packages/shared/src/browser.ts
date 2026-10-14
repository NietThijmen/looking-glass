export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  picking: boolean
  /** The user is dragging out a region to capture. */
  capturing: boolean
  /** An agent drove this tab in the last few seconds. */
  agentActive: boolean
  /** The user pressed Stop: agent browser tools are refused until allowed again. */
  agentBlocked: boolean
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ConsoleLevel = 'log' | 'info' | 'warning' | 'error'

export interface ConsoleEntry {
  id: number
  level: ConsoleLevel
  /** console, exception or network. */
  source: 'console' | 'exception' | 'network'
  text: string
  url?: string
  line?: number
  time: number
}

/** Where an element probably came from in the workspace. */
export interface SourceHint {
  path: string
  line?: number
  /** How we know: framework metadata and data-lg-source are exact; search hits are guesses. */
  via: 'react' | 'vue' | 'svelte' | 'data-lg-source' | 'stylesheet' | 'search'
  component?: string
}

export interface PickedElement {
  kind: 'element'
  tabId: string
  pageUrl: string
  pageTitle: string
  selector: string
  tag: string
  id?: string
  classes: string[]
  text: string
  role?: string
  accessibleName?: string
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  /** Trimmed outerHTML: long subtrees collapsed to fit the budget. */
  html: string
  /** Outline of the parent chain, outermost first (`body`, `main.content`, …). */
  ancestors: string[]
  /** Matched CSS rules: selector, declarations, and where they came from. */
  rules: Array<{ selector: string; css: string; source?: string }>
  /** Non-default computed styles that matter for layout and look. */
  computed: Record<string, string>
  /** PNG, base64, of the element with some padding. */
  screenshot?: string
  /** UI framework detected on the element, with the owning component when known. */
  framework?: { name: 'react' | 'vue' | 'svelte' | 'angular'; component?: string }
  sources: SourceHint[]
}

/** A dragged rectangle of the page, for questions that aren't about one element. */
export interface PickedRegion {
  kind: 'region'
  tabId: string
  pageUrl: string
  pageTitle: string
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  /** PNG, base64. */
  screenshot: string
}

export type Picked = PickedElement | PickedRegion

/** How a new pick changes the tab's selection. */
export type PickMode = 'replace' | 'add' | 'replace-last'

/** The textual parts of a picked element; the renderer lets the user untick each. */
export function elementSections(el: PickedElement): { summary: string; markup: string; styles: string } {
  const exact = el.sources.filter((s) => s.via !== 'search' && s.via !== 'stylesheet')
  const styleFiles = el.sources.filter((s) => s.via === 'stylesheet')
  const guesses = el.sources.filter((s) => s.via === 'search')
  const where = (list: SourceHint[]) => list.map((s) => `${s.path}${s.line ? `:${s.line}` : ''}`).join(', ')
  const summary = [
    `Element on ${el.pageUrl} (${el.pageTitle || 'untitled'})`,
    `Selector: ${el.selector}`,
    `Tag: <${el.tag}>${el.id ? ` id="${el.id}"` : ''}${el.classes.length ? ` class="${el.classes.join(' ')}"` : ''}`,
    el.role ? `Accessible role/name: ${el.role}${el.accessibleName ? ` "${el.accessibleName}"` : ''}` : '',
    el.text ? `Text: ${el.text}` : '',
    `Box: ${el.rect.width}×${el.rect.height} at (${el.rect.x}, ${el.rect.y}) in a ${el.viewport.width}×${el.viewport.height} viewport`,
    el.framework
      ? `Framework: ${el.framework.name}${el.framework.component ? `, component <${el.framework.component}>` : ''}`
      : '',
    exact.length
      ? `Rendered by: ${exact.map((s) => `${s.path}${s.line ? `:${s.line}` : ''} (${s.via})`).join(', ')}`
      : '',
    styleFiles.length ? `Styles in: ${where(styleFiles)}` : '',
    guesses.length ? `Possibly rendered by (guess from text search): ${where(guesses)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const markup = [
    el.ancestors.length
      ? `Parent chain: ${[...el.ancestors, el.selector.split(' > ').at(-1)].join(' > ')}`
      : '',
    'HTML:',
    '```html',
    el.html,
    '```',
  ]
    .filter(Boolean)
    .join('\n')

  const styleLines: string[] = []
  if (el.rules.length) {
    styleLines.push('Matched CSS rules (most specific last):', '```css')
    for (const rule of el.rules)
      styleLines.push(`${rule.source ? `/* ${rule.source} */\n` : ''}${rule.selector} { ${rule.css} }`)
    styleLines.push('```')
  }
  const computed = Object.entries(el.computed)
  if (computed.length)
    styleLines.push('Computed styles: ' + computed.map(([k, v]) => `${k}: ${v}`).join('; '))
  return { summary, markup, styles: styleLines.join('\n') }
}

/** Full text description of a picked element or region (for agent tools). */
export function describePicked(item: Picked): string {
  if (item.kind === 'region') return describeRegion(item)
  const { summary, markup, styles } = elementSections(item)
  return [summary, markup, styles].filter(Boolean).join('\n\n')
}

export function describeRegion(r: PickedRegion): string {
  return `Screenshot of a region of ${r.pageUrl} (${r.pageTitle || 'untitled'}): ${r.rect.width}×${r.rect.height} at (${r.rect.x}, ${r.rect.y}) in a ${r.viewport.width}×${r.viewport.height} viewport.`
}

/** The floating "ask about this" input shown next to the last pick. */
export interface AskOptions {
  /** The picked box, in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number }
  placeholder: string
  /** Whether ↑/↓ may walk to the parent or child element. */
  canWalk: boolean
  text: string
}

export type AskResult =
  | { type: 'send' | 'newChat'; text: string }
  | { type: 'add' | 'dismiss'; text: string }
  | { type: 'walk'; direction: 'parent' | 'child'; text: string }

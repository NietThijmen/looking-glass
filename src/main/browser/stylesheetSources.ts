import { SourceMapConsumer, type RawSourceMap } from 'source-map-js'

const MAX_MAP_BYTES = 5 * 1024 * 1024

/** What CDP's `CSS.styleSheetAdded` tells us about a stylesheet, plus dev-server metadata. */
export interface SheetInfo {
  sourceURL: string
  sourceMapURL?: string
  /** `<style>` elements in the page: rule lines are relative to the sheet, which starts here. */
  inlineStartLine?: number
  /** Vite dev injects CSS as `<style data-vite-dev-id="/abs/path/App.css">`. */
  viteId?: string
}

export interface RuleSource {
  /** Workspace-relative path, when the rule comes from a workspace file. */
  path: string | null
  line: number
  /** What to show next to the rule: a workspace path or the stylesheet URL, with line. */
  display: string
}

export interface StylesheetDeps {
  fetchText(url: string): Promise<string>
  toWorkspacePath(pathOrUrl: string): Promise<string | null>
}

function decodeDataUrl(url: string): string | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url)
  if (!match) return null
  return match[1] ? Buffer.from(match[2]!, 'base64').toString('utf8') : decodeURIComponent(match[2]!)
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

/**
 * Maps CSS rule positions (as CDP reports them) back to the files the user
 * edits: through the stylesheet's source map (Sass, PostCSS, CSS modules), the
 * Vite dev id of injected `<style>` tags, or the stylesheet URL itself.
 */
export class StylesheetSources {
  #sheets = new Map<string, SheetInfo>()
  #maps = new Map<string, Promise<SourceMapConsumer | null>>()

  constructor(private readonly deps: StylesheetDeps) {}

  add(styleSheetId: string, info: SheetInfo): void {
    this.#sheets.set(styleSheetId, info)
  }

  update(styleSheetId: string, patch: Partial<SheetInfo>): void {
    const info = this.#sheets.get(styleSheetId)
    if (info) this.#sheets.set(styleSheetId, { ...info, ...patch })
  }

  clear(): void {
    this.#sheets.clear()
    this.#maps.clear()
  }

  /** `line` and `column` are zero-based, relative to the stylesheet text (as in CDP ranges). */
  async resolve(styleSheetId: string, line: number, column: number): Promise<RuleSource | undefined> {
    const sheet = this.#sheets.get(styleSheetId)
    if (!sheet) return undefined

    if (sheet.sourceMapURL) {
      const consumer = await this.#map(sheet)
      const pos = consumer?.originalPositionFor({ line: line + 1, column })
      if (pos?.source && pos.line) {
        const base = sheet.sourceMapURL.startsWith('data:') ? sheet.sourceURL : sheet.sourceMapURL
        const path =
          (await this.deps.toWorkspacePath(resolveUrl(pos.source, base))) ??
          (await this.deps.toWorkspacePath(pos.source))
        return { path, line: pos.line, display: `${path ?? pos.source}:${pos.line}` }
      }
    }

    if (sheet.viteId) {
      const path = await this.deps.toWorkspacePath(sheet.viteId)
      if (path) {
        // Preprocessed languages are compiled before injection, so their lines don't match the source.
        const plainCss = /\.css$/i.test(path)
        return { path, line: plainCss ? line + 1 : 0, display: plainCss ? `${path}:${line + 1}` : path }
      }
    }

    if (!sheet.sourceURL) return undefined
    const absoluteLine = line + 1 + (sheet.inlineStartLine ?? 0)
    const path = await this.deps.toWorkspacePath(sheet.sourceURL)
    return { path, line: absoluteLine, display: `${path ?? sheet.sourceURL}:${absoluteLine}` }
  }

  #map(sheet: SheetInfo): Promise<SourceMapConsumer | null> {
    const url = resolveUrl(sheet.sourceMapURL!, sheet.sourceURL || 'about:blank')
    let pending = this.#maps.get(url)
    if (!pending) {
      pending = (async () => {
        try {
          let raw = url.startsWith('data:') ? decodeDataUrl(url) : null
          // Only fetch maps over http(s): a page must not make us read local files.
          if (raw === null && /^https?:/i.test(url)) raw = await this.deps.fetchText(url)
          if (!raw || raw.length > MAX_MAP_BYTES) return null
          return new SourceMapConsumer(JSON.parse(raw) as RawSourceMap)
        } catch {
          return null
        }
      })()
      this.#maps.set(url, pending)
    }
    return pending
  }
}

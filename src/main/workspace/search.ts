import { rgPath as bundledRgPath } from '@vscode/ripgrep'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import type { SearchFileResult, SearchQuery, SearchResult } from '../../shared/ipc'

export const MAX_MATCHES = 2000
const MAX_LINE_CHARS = 300

// In a packaged app the binary lives in app.asar.unpacked (see electron-builder.yml).
const rgPath = bundledRgPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

function splitGlobs(globs: string | undefined): string[] {
  return (globs ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
}

export function buildRgArgs(query: SearchQuery): string[] {
  const args = ['--json', '--hidden', '--glob', '!.git', '--max-columns', '1000', '--max-filesize', '2M']
  if (query.caseSensitive === true) args.push('--case-sensitive')
  else if (query.caseSensitive === false) args.push('--ignore-case')
  else args.push('--smart-case')
  if (!query.regex) args.push('--fixed-strings')
  if (query.wholeWord) args.push('--word-regexp')
  for (const glob of splitGlobs(query.include)) args.push('--glob', glob)
  for (const glob of splitGlobs(query.exclude)) args.push('--glob', `!${glob}`)
  args.push('--regexp', query.pattern, '--', '.')
  return args
}

/** UTF-8 byte offset → UTF-16 index into `text`. */
function byteToCharOffset(text: string, byteOffset: number): number {
  return Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8').length
}

interface RgMatchMessage {
  type: 'match'
  data: {
    path: { text?: string }
    lines: { text?: string }
    line_number: number
    submatches: Array<{ start: number; end: number }>
  }
}

/**
 * Fold one line of `rg --json` output into `files`. Returns the number of
 * matches added. Exported for tests.
 */
export function collectRgLine(line: string, files: Map<string, SearchFileResult>): number {
  let message: { type: string }
  try {
    message = JSON.parse(line)
  } catch {
    return 0
  }
  if (message.type !== 'match') return 0
  const { data } = message as RgMatchMessage
  // Non-UTF-8 paths and lines come base64-encoded with no `text`; skip them.
  if (data.path.text === undefined || data.lines.text === undefined) return 0

  const filePath = data.path.text.replace(/^\.\//, '')
  const fullText = data.lines.text.replace(/\r?\n$/, '')
  const ranges = data.submatches.map(
    (m) => [byteToCharOffset(fullText, m.start), byteToCharOffset(fullText, m.end)] as [number, number],
  )

  // Keep long lines readable: show a window around the first match.
  let text = fullText
  let shift = 0
  if (text.length > MAX_LINE_CHARS) {
    shift = Math.max(0, (ranges[0]?.[0] ?? 0) - 40)
    text = (shift ? '…' : '') + text.slice(shift, shift + MAX_LINE_CHARS)
  }
  const adjust = (n: number): number => Math.min(text.length, n - shift + (shift ? 1 : 0))

  let file = files.get(filePath)
  if (!file) {
    file = { path: filePath, matches: [] }
    files.set(filePath, file)
  }
  file.matches.push({
    line: data.line_number,
    text,
    ranges: ranges.map(([s, e]) => [adjust(s), adjust(e)] as [number, number]).filter(([s, e]) => e > s),
  })
  return data.submatches.length || 1
}

const MAX_LISTED_FILES = 50_000

/** Every workspace file ripgrep would search (gitignore respected), relative and sorted. */
export function listFiles(root: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(rgPath, ['--files', '--hidden', '--glob', '!.git'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files: string[] = []
    const lines = readline.createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      if (files.length < MAX_LISTED_FILES) files.push(line.replace(/^\.\//, ''))
      else child.kill()
    })
    child.on('error', () => resolve([]))
    child.on('close', () => resolve(files.sort()))
  })
}

const SOURCE_EXCLUDES = [
  '!node_modules',
  '!dist',
  '!build',
  '!out',
  '!.next',
  '!coverage',
  '!*.min.*',
  '!*.map',
  '!*.lock',
  '!*-lock.*',
]

/** Files containing `needle` literally, for guessing where page content comes from. */
export function quickFind(root: string, needle: string, limit = 3): Promise<string[]> {
  return new Promise((resolve) => {
    const args = ['--files-with-matches', '--fixed-strings', '--max-count', '1', '--max-filesize', '1M']
    for (const glob of SOURCE_EXCLUDES) args.push('--glob', glob)
    args.push('--regexp', needle, '--', '.')
    const child = spawn(rgPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    const files: string[] = []
    const lines = readline.createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      if (files.length < limit) files.push(line.replace(/^\.\//, ''))
      if (files.length >= limit) child.kill()
    })
    child.on('error', () => resolve([]))
    child.on('close', () => resolve(files))
  })
}

/** Runs one search at a time; starting a new one cancels the previous. */
export class SearchService {
  #current: ChildProcess | null = null

  run(root: string, query: SearchQuery): Promise<SearchResult> {
    this.cancel()
    if (!query.pattern) return Promise.resolve({ files: [], matchCount: 0, truncated: false })

    return new Promise((resolve) => {
      const child = spawn(rgPath, buildRgArgs(query), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
      this.#current = child
      const files = new Map<string, SearchFileResult>()
      let matchCount = 0
      let truncated = false
      let stderr = ''

      const lines = readline.createInterface({ input: child.stdout! })
      lines.on('line', (line) => {
        if (truncated) return
        matchCount += collectRgLine(line, files)
        if (matchCount >= MAX_MATCHES) {
          truncated = true
          child.kill()
        }
      })
      child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      child.on('error', (error) =>
        resolve({ files: [], matchCount: 0, truncated: false, error: error.message }),
      )
      child.on('close', (code) => {
        if (this.#current === child) this.#current = null
        // rg exits 1 for "no matches", 2 for errors (bad regex etc.).
        const error = code === 2 && !truncated ? stderr.trim() || 'Search failed' : undefined
        resolve({ files: [...files.values()], matchCount, truncated, ...(error ? { error } : {}) })
      })
    })
  }

  cancel(): void {
    this.#current?.kill()
    this.#current = null
  }
}

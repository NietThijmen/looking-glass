import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { EditorSnapshot } from '@lookingglass/shared/agent'
import type { Diagnostic, DiagnosticSeverity, DiagnosticsByPath } from '@lookingglass/shared/diagnostics'
import type { WorkspaceService } from '@lookingglass/workspace'
import { LspClient, type LspProcessSpec } from './LspClient'

const require = createRequire(import.meta.url)

/** File extensions the TypeScript language server handles, with their LSP language ids. */
const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
}

/** Files opened for agents (not in the editor) that stay open, oldest dropped first. */
const MAX_PINNED = 30
const FIRST_RESULT_MS = 15_000
const SEVERITIES: Record<number, DiagnosticSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

interface LspDiagnostic {
  range: Diagnostic['range']
  severity?: number
  message: string
  source?: string
  code?: string | number
}

interface OpenDocument {
  version: number
  text: string
  languageId: string
}

export function languageId(relPath: string): string | null {
  return LANGUAGES[path.extname(relPath).toLowerCase()] ?? null
}

/** typescript-language-server, run with Electron's own Node (plain Node in tests). */
export function typescriptServerSpec(cwd: string): LspProcessSpec {
  const pkg = require.resolve('typescript-language-server/package.json')
  return {
    command: process.execPath,
    args: [path.join(path.dirname(pkg), 'lib', 'cli.mjs'), '--stdio'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    cwd,
  }
}

export interface DiagnosticsDeps {
  workspace: Pick<WorkspaceService, 'root' | 'readText'>
  /** Process to run; defaults to typescript-language-server. */
  spec?(root: string): LspProcessSpec
  onChange(path: string, diagnostics: Diagnostic[]): void
}

/**
 * Diagnostics from language servers (TypeScript and JavaScript for now). Keeps
 * the server's open documents in step with the editor's open files, including
 * unsaved edits, and opens other files on demand when an agent asks about them.
 */
export class DiagnosticsService {
  #client: LspClient | null = null
  #starting: Promise<LspClient | null> | null = null
  #root: string | null = null
  #documents = new Map<string, OpenDocument>()
  #diagnostics = new Map<string, Diagnostic[]>()
  #editorFiles = new Set<string>()
  #dirty: Record<string, string> = {}
  #pinned: string[] = []
  #waiters = new Map<string, Array<() => void>>()
  #error: string | null = null
  /** Serializes document syncs so versions go out in order. */
  #queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: DiagnosticsDeps) {}

  /** Why diagnostics are unavailable, if the server failed to start. */
  get error(): string | null {
    return this.#error
  }

  all(): DiagnosticsByPath {
    return Object.fromEntries([...this.#diagnostics].filter(([, list]) => list.length))
  }

  /** Follow the editor: open its TS/JS files in the server, close the rest. */
  syncEditor(snapshot: EditorSnapshot): Promise<void> {
    this.#editorFiles = new Set(snapshot.openFiles.filter((p) => languageId(p)))
    this.#dirty = snapshot.dirty
    return this.#enqueue(() => this.#reconcile())
  }

  /** Files changed on disk (agent writes, git checkouts): refresh the clean ones we have open. */
  filesChanged(paths: string[]): Promise<void> {
    const affected = paths.filter((p) => this.#documents.has(p) && !Object.hasOwn(this.#dirty, p))
    if (!affected.length) return Promise.resolve()
    return this.#enqueue(async () => {
      for (const p of affected) await this.#syncDocument(p)
    })
  }

  /**
   * Diagnostics for one file, opening it in the server if needed and waiting
   * for the first result. Without a path: everything currently known.
   */
  async diagnostics(relPath?: string): Promise<DiagnosticsByPath> {
    if (!relPath) return this.all()
    if (!languageId(relPath))
      throw new Error(`No language server for ${relPath} (TypeScript and JavaScript only).`)
    const fresh = !this.#documents.has(relPath)
    const result = fresh ? this.#waitFor(relPath) : Promise.resolve()
    if (fresh) {
      this.#pinned = [...this.#pinned.filter((p) => p !== relPath), relPath].slice(-MAX_PINNED)
      await this.#enqueue(() => this.#reconcile())
      if (!this.#documents.has(relPath)) throw new Error(this.#error ?? `Could not open ${relPath}.`)
    }
    await result
    const list = this.#diagnostics.get(relPath) ?? []
    return list.length ? { [relPath]: list } : {}
  }

  async dispose(): Promise<void> {
    const client = this.#client
    this.#client = null
    this.#starting = null
    this.#root = null
    this.#documents.clear()
    this.#pinned = []
    this.#editorFiles = new Set()
    this.#error = null
    for (const p of [...this.#diagnostics.keys()]) this.#publish(p, [])
    for (const waiters of this.#waiters.values()) for (const done of waiters) done()
    this.#waiters.clear()
    await client?.shutdown()
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(task).catch((error: unknown) => {
      console.error('[lsp]', error)
    })
    this.#queue = next
    return next
  }

  async #reconcile(): Promise<void> {
    const wanted = new Set([...this.#editorFiles, ...this.#pinned])
    if (!wanted.size && !this.#documents.size) return
    const client = await this.#ensure()
    if (!client) return
    for (const p of [...this.#documents.keys()]) {
      if (wanted.has(p)) continue
      this.#documents.delete(p)
      client.notify('textDocument/didClose', { textDocument: { uri: this.#uri(p) } })
      this.#publish(p, [])
    }
    for (const p of wanted) await this.#syncDocument(p)
  }

  async #syncDocument(relPath: string): Promise<void> {
    const client = this.#client
    const language = languageId(relPath)
    if (!client || !language) return
    const text = Object.hasOwn(this.#dirty, relPath)
      ? this.#dirty[relPath]!
      : await this.deps.workspace.readText(relPath)
    const open = this.#documents.get(relPath)
    if (text === null) {
      if (open) {
        this.#documents.delete(relPath)
        client.notify('textDocument/didClose', { textDocument: { uri: this.#uri(relPath) } })
        this.#publish(relPath, [])
      }
      return
    }
    if (!open) {
      this.#documents.set(relPath, { version: 1, text, languageId: language })
      client.notify('textDocument/didOpen', {
        textDocument: { uri: this.#uri(relPath), languageId: language, version: 1, text },
      })
    } else if (open.text !== text) {
      open.version++
      open.text = text
      client.notify('textDocument/didChange', {
        textDocument: { uri: this.#uri(relPath), version: open.version },
        contentChanges: [{ text }],
      })
    }
  }

  async #ensure(): Promise<LspClient | null> {
    const root = this.deps.workspace.root
    if (!root) return null
    if (this.#client && this.#root === root) return this.#client
    if (this.#starting) return this.#starting
    this.#starting = this.#start(root).finally(() => {
      this.#starting = null
    })
    return this.#starting
  }

  async #start(root: string): Promise<LspClient | null> {
    const spec = this.deps.spec?.(root) ?? typescriptServerSpec(root)
    const client: LspClient = new LspClient(spec, (error) => {
      if (this.#client !== client) return
      // Restart on the next sync; documents have to be reopened.
      this.#client = null
      this.#documents.clear()
      if (error) this.#error = error.message
    })
    try {
      await client.start()
      client.onNotification('textDocument/publishDiagnostics', (params) => {
        const { uri, diagnostics } = params as { uri: string; diagnostics: LspDiagnostic[] }
        const rel = this.#relative(uri)
        if (rel === null || !this.#documents.has(rel)) return
        this.#publish(rel, diagnostics.map(toDiagnostic))
      })
      await client.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
        initializationOptions: { preferences: {} },
      })
      client.notify('initialized', {})
    } catch (error) {
      this.#error = `${error instanceof Error ? error.message : String(error)}\n${client.stderrTail}`.trim()
      console.error('[lsp] could not start the TypeScript language server:', this.#error)
      await client.shutdown()
      return null
    }
    if (this.deps.workspace.root !== root) {
      await client.shutdown()
      return null
    }
    this.#client = client
    this.#root = root
    this.#error = null
    return client
  }

  #publish(relPath: string, diagnostics: Diagnostic[]): void {
    const had = this.#diagnostics.get(relPath)?.length ?? 0
    if (diagnostics.length) this.#diagnostics.set(relPath, diagnostics)
    else this.#diagnostics.delete(relPath)
    if (had || diagnostics.length) this.deps.onChange(relPath, diagnostics)
    const waiters = this.#waiters.get(relPath)
    if (waiters) {
      this.#waiters.delete(relPath)
      for (const done of waiters) done()
    }
  }

  /** Resolves on the next publish for `relPath`, or after a timeout (the server may stay quiet). */
  #waitFor(relPath: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, FIRST_RESULT_MS)
      const list = this.#waiters.get(relPath) ?? []
      list.push(() => {
        clearTimeout(timer)
        resolve()
      })
      this.#waiters.set(relPath, list)
    })
  }

  #uri(relPath: string): string {
    return pathToFileURL(path.join(this.#root ?? this.deps.workspace.root ?? '', relPath)).href
  }

  #relative(uri: string): string | null {
    const root = this.#root
    if (!root || !uri.startsWith('file:')) return null
    const rel = path.relative(root, fileURLToPath(uri))
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/')
  }
}

function toDiagnostic(d: LspDiagnostic): Diagnostic {
  return {
    range: d.range,
    severity: SEVERITIES[d.severity ?? 1] ?? 'error',
    message: d.message,
    ...(d.source ? { source: d.source } : {}),
    ...(d.code !== undefined ? { code: d.code } : {}),
  }
}

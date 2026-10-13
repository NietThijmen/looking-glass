import fs from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry, FileReadResult, FileWriteResult, WorkspaceInfo } from '../../shared/ipc'
import { resolveInside } from '../security/paths'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000
const HIDDEN_NAMES = new Set(['.git', '.DS_Store'])

export class WorkspaceError extends Error {}

/** Convert an absolute path inside `root` to a workspace-relative POSIX path. */
export function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/**
 * The single gate for workspace file access. Every path is checked to stay
 * inside the root, including after resolving symlinks. Electron-free so it can
 * be unit tested and later reused by the ACP `fs/*` handlers.
 */
export class WorkspaceService {
  #root: string | null = null

  get root(): string | null {
    return this.#root
  }

  get info(): WorkspaceInfo | null {
    return this.#root ? { root: this.#root, name: path.basename(this.#root) } : null
  }

  async open(root: string): Promise<WorkspaceInfo> {
    const real = await fs.realpath(root)
    const stat = await fs.stat(real)
    if (!stat.isDirectory()) throw new WorkspaceError(`Not a directory: ${root}`)
    this.#root = real
    return this.info!
  }

  close(): void {
    this.#root = null
  }

  /**
   * Resolve a workspace-relative path to an absolute one, rejecting anything
   * that escapes the root lexically or through symlinks. For paths that don't
   * exist yet, the nearest existing ancestor is checked instead.
   */
  async resolve(relPath: string): Promise<string> {
    const root = this.#requireRoot()
    const lexical = resolveInside(root, relPath)
    if (!lexical) throw new WorkspaceError(`Path escapes workspace: ${relPath}`)

    let probe = lexical
    for (;;) {
      try {
        const real = await fs.realpath(probe)
        if (real !== root && !real.startsWith(root + path.sep)) {
          throw new WorkspaceError(`Path escapes workspace via symlink: ${relPath}`)
        }
        return lexical
      } catch (error) {
        if (error instanceof WorkspaceError) throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = path.dirname(probe)
        if (parent === probe) throw error
        probe = parent
      }
    }
  }

  async readDir(relPath: string): Promise<DirEntry[]> {
    const root = this.#requireRoot()
    const dir = await this.resolve(relPath)
    const dirents = await fs.readdir(dir, { withFileTypes: true })

    const entries: DirEntry[] = []
    for (const dirent of dirents) {
      if (HIDDEN_NAMES.has(dirent.name)) continue
      const absolute = path.join(dir, dirent.name)
      let isDir = dirent.isDirectory()
      if (dirent.isSymbolicLink()) {
        // Show symlinks by what they point to; skip broken or escaping ones.
        try {
          await this.resolve(toRelative(root, absolute))
          isDir = (await fs.stat(absolute)).isDirectory()
        } catch {
          continue
        }
      } else if (!isDir && !dirent.isFile()) {
        continue
      }
      entries.push({ name: dirent.name, path: toRelative(root, absolute), kind: isDir ? 'dir' : 'file' })
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  async readFile(relPath: string): Promise<FileReadResult> {
    const file = await this.resolve(relPath)
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw new WorkspaceError(`Not a file: ${relPath}`)

    const base = { path: relPath, size: stat.size, mtimeMs: stat.mtimeMs }
    if (stat.size > MAX_FILE_BYTES) return { ...base, contents: '', binary: false, tooLarge: true }

    const buffer = await fs.readFile(file)
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { ...base, contents: '', binary: true, tooLarge: false }
    }
    return { ...base, contents: buffer.toString('utf8'), binary: false, tooLarge: false }
  }

  async writeFile(relPath: string, contents: string): Promise<FileWriteResult> {
    const file = await this.resolve(relPath)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, contents, 'utf8')
    const stat = await fs.stat(file)
    return { mtimeMs: stat.mtimeMs }
  }

  /** Delete a file. Missing files are fine. */
  async deleteFile(relPath: string): Promise<void> {
    const file = await this.resolve(relPath)
    await fs.rm(file, { force: true })
  }

  /** Text contents, or null when the file is missing, binary or too large to review. */
  async readText(relPath: string): Promise<string | null> {
    try {
      const file = await this.readFile(relPath)
      return file.binary || file.tooLarge ? null : file.contents
    } catch {
      return null
    }
  }

  #requireRoot(): string {
    if (!this.#root) throw new WorkspaceError('No workspace open')
    return this.#root
  }
}

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Heavy or generated folders that are never worth snapshotting, even when not gitignored. */
const DEFAULT_EXCLUDES = ['node_modules/', '.venv/', '__pycache__/', '.DS_Store', '.lookingglass/']

export interface TreeChange {
  path: string
  /** A = added since the checkpoint, D = deleted, M = modified. */
  status: 'A' | 'D' | 'M'
}

/**
 * Workspace snapshots in a private "shadow" git repository under userData.
 * It uses the workspace as its work tree but its own git dir and index, so it
 * works for folders that aren't git repos and never touches the user's `.git`.
 * The user's `.gitignore` files are still honoured.
 *
 * A checkpoint is a git tree id: `snapshot()` stages the whole work tree into
 * the shadow index (incremental, so cheap after the first time) and writes a tree.
 */
export class Checkpoints {
  readonly gitDir: string
  #ready: Promise<void> | null = null

  constructor(
    readonly root: string,
    storageDir: string,
  ) {
    const id = createHash('sha256').update(root).digest('hex').slice(0, 16)
    this.gitDir = path.join(storageDir, `${path.basename(root)}-${id}.git`)
  }

  async snapshot(): Promise<string> {
    await this.#init()
    await this.#git(['add', '--all', '--', '.'])
    return (await this.#git(['write-tree'])).trim()
  }

  /** Files that differ between two trees. */
  async changes(from: string, to: string): Promise<TreeChange[]> {
    const out = await this.#git(['diff-tree', '-r', '-z', '--no-renames', '--name-status', from, to])
    const fields = out.split('\0').filter(Boolean)
    const changes: TreeChange[] = []
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const status = fields[i]![0] as TreeChange['status']
      changes.push({ path: fields[i + 1]!, status: status === 'A' || status === 'D' ? status : 'M' })
    }
    return changes
  }

  /** File contents in a tree, or null if the file isn't in it. */
  async read(tree: string, relPath: string): Promise<string | null> {
    try {
      return await this.#git(['cat-file', 'blob', `${tree}:${relPath}`])
    } catch {
      return null
    }
  }

  async #init(): Promise<void> {
    this.#ready ??= (async () => {
      try {
        await fs.access(path.join(this.gitDir, 'HEAD'))
      } catch {
        await fs.mkdir(this.gitDir, { recursive: true })
        await exec('git', ['init', '--quiet', '--bare', this.gitDir], { env: cleanEnv() })
        // A bare repo plus an explicit work tree; core.bare must be off for `add`.
        await this.#git(['config', 'core.bare', 'false'])
        await this.#git(['config', 'core.autocrlf', 'false'])
      }
      await fs.mkdir(path.join(this.gitDir, 'info'), { recursive: true })
      await fs.writeFile(path.join(this.gitDir, 'info', 'exclude'), DEFAULT_EXCLUDES.join('\n') + '\n')
    })()
    try {
      await this.#ready
    } catch (error) {
      this.#ready = null
      throw error
    }
  }

  async #git(args: string[]): Promise<string> {
    const { stdout } = await exec('git', ['--git-dir', this.gitDir, '--work-tree', this.root, ...args], {
      cwd: this.root,
      env: cleanEnv(),
      maxBuffer: 256 * 1024 * 1024,
    })
    return stdout
  }
}

/** Never let an inherited GIT_DIR / GIT_INDEX_FILE point the shadow repo at the user's. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') && key !== 'GIT_TERMINAL_PROMPT') delete env[key]
  }
  return env
}

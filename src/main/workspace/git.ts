import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitFileStatus, GitStatus, GitStatusEntry } from '../../shared/ipc'

const exec = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    // Never block on credential or editor prompts, and don't take locks for status.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
  })
  return stdout
}

function codeToStatus(code: string): GitFileStatus | null {
  switch (code) {
    case 'M':
    case 'T':
      return 'modified'
    case 'A':
    case 'C':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return null
  }
}

/**
 * Parse `git status --porcelain=v2 -z --branch` output. Paths in the output are
 * relative to the repository root; `prefix` (from `rev-parse --show-prefix`) is
 * the workspace's location inside the repo, and entries outside it are dropped.
 */
export function parsePorcelainV2(output: string, prefix = ''): GitStatus {
  const records = output.split('\0')
  const entries: GitStatusEntry[] = []
  let branch: string | null = null

  const toWorkspace = (repoPath: string): string | null =>
    repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (!record) continue

    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length)
      branch = head === '(detached)' ? null : head
      continue
    }
    if (record.startsWith('#')) continue

    const kind = record[0]
    if (kind === '?') {
      const path = toWorkspace(record.slice(2))
      if (path) entries.push({ path, status: 'untracked', staged: false })
      continue
    }
    if (kind === '1' || kind === '2' || kind === 'u') {
      const fields = record.split(' ')
      const xy = fields[1] ?? '..'
      // Field counts before the path: 1 → 8, 2 → 9 (extra score field), u → 10.
      const pathIndex = kind === '1' ? 8 : kind === '2' ? 9 : 10
      const repoPath = fields.slice(pathIndex).join(' ')
      // Renames carry the original path as the next NUL-separated record.
      const from = kind === '2' ? records[++i] : undefined
      const path = toWorkspace(repoPath)
      if (!path) continue

      if (kind === 'u') {
        entries.push({ path, status: 'conflicted', staged: false })
        continue
      }
      const [x, y] = [xy[0]!, xy[1]!]
      const status = codeToStatus(y !== '.' ? y : x) ?? 'modified'
      const entry: GitStatusEntry = { path, status, staged: x !== '.' }
      const fromPath = from !== undefined ? toWorkspace(from) : null
      if (fromPath) entry.from = fromPath
      entries.push(entry)
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { branch, entries }
}

export class GitService {
  /** Returns null when the workspace isn't inside a git repository (or git is missing). */
  async status(root: string): Promise<GitStatus | null> {
    let prefix: string
    try {
      prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim()
    } catch {
      return null
    }
    const output = await git(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    return parsePorcelainV2(output, prefix)
  }

  /** Working tree vs HEAD for the workspace (empty outside a repo or before the first commit). */
  async diff(root: string): Promise<string> {
    try {
      return await git(root, ['diff', 'HEAD', '--no-color', '--', '.'])
    } catch {
      return ''
    }
  }

  /** File contents at HEAD, or null if the file isn't tracked there. */
  async headContents(root: string, relPath: string): Promise<string | null> {
    try {
      // `./` makes the path relative to cwd (the workspace) instead of the repo root.
      return await git(root, ['show', `HEAD:./${relPath}`])
    } catch {
      return null
    }
  }
}

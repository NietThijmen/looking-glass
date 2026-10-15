import { execFile } from 'node:child_process'
import { childEnv } from '@lookingglass/acp/childEnv'

const TIMEOUT_MS = 5000
const MARKER = '__LG_PATH__'

let cached: Promise<string | null> | undefined

/**
 * The PATH of the user's interactive login shell. Apps launched from Finder/Dock
 * inherit a minimal PATH, and a plain `-lc` shell skips `.zshrc`/`.bashrc`, where
 * tools like nvm, Homebrew or pyenv usually extend it. Resolved once and cached;
 * `null` when it can't be determined (Windows, no shell, timeout).
 */
export function loginShellPath(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  cached ??= new Promise((resolve) => {
    const shell = process.env['SHELL'] ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    execFile(
      shell,
      ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: TIMEOUT_MS, env: childEnv({ TERM: 'dumb' }) },
      (error, stdout) => {
        // rc files may print banners, so only trust what sits between the markers.
        const found = new RegExp(`${MARKER}(.*)${MARKER}`, 's').exec(stdout)?.[1]
        resolve(error || !found ? null : found)
      },
    )
  })
  return cached
}

/** Login-shell PATH first, then whatever PATH we already have, without duplicates. */
export function mergePaths(shellPath: string | null, current: string | undefined): string | undefined {
  if (!shellPath) return current
  const parts = [...shellPath.split(':'), ...(current?.split(':') ?? [])].filter(Boolean)
  return [...new Set(parts)].join(':')
}

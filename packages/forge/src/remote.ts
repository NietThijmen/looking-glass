/** A git remote reduced to the host and repository path. Owner may contain slashes (GitLab subgroups). */
export interface ParsedRemote {
  host: string
  owner: string
  repo: string
}

const URL_REMOTE = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i
const SCP_REMOTE = /^(?:[^@/]+@)?([^:/]+):(.+)$/

/**
 * Parse `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git`.
 * The `.git` suffix is optional. Returns null when the string is not a remote URL.
 */
export function parseRemote(input: string): ParsedRemote | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let host: string
  let path: string
  const asUrl = URL_REMOTE.exec(trimmed)
  if (asUrl) {
    host = asUrl[1]!
    path = asUrl[2]!
  } else if (!trimmed.includes('://')) {
    const asScp = SCP_REMOTE.exec(trimmed)
    if (!asScp) return null
    host = asScp[1]!
    path = asScp[2]!
  } else {
    return null
  }

  path = (path.split(/[?#]/, 1)[0] ?? path).replace(/\/+$/, '')
  if (path.endsWith('.git')) path = path.slice(0, -'.git'.length)
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const repo = parts[parts.length - 1]!
  const owner = parts.slice(0, -1).join('/')
  if (!host || !owner || !repo) return null
  return { host: host.toLowerCase(), owner, repo }
}

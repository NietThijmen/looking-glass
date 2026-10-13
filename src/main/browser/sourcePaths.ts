import fs from 'node:fs/promises'
import path from 'node:path'
import { listFiles } from '../workspace/search'

/**
 * Map something a page reports (a dev-server URL, a file:// URL, an absolute
 * path from framework debug info, a bundler-relative path) to an existing
 * workspace file. Returns a workspace-relative POSIX path or null.
 */
export async function toWorkspacePath(root: string, pathOrUrl: string): Promise<string | null> {
  let candidate = pathOrUrl.trim()
  if (!candidate) return null

  if (/^https?:\/\//i.test(candidate)) {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(candidate).pathname)
    } catch {
      return null
    }
    // Vite serves files outside its root as /@fs/<absolute path>.
    candidate = pathname.startsWith('/@fs/') ? pathname.slice(4) : pathname.replace(/^\/+/, '')
  } else if (candidate.startsWith('file://')) {
    try {
      candidate = decodeURIComponent(new URL(candidate).pathname)
    } catch {
      return null
    }
  } else {
    // webpack:///./src/App.tsx, webpack://app/./src/App.tsx
    candidate = candidate.replace(/^webpack:\/\/[^/]*\/(\.\/)?/, '')
  }
  candidate = candidate.replace(/[?#].*$/, '')

  const absolute = path.isAbsolute(candidate) ? candidate : path.join(root, candidate)
  const rel = path.relative(root, absolute)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  try {
    if (!(await fs.stat(absolute)).isFile()) return null
  } catch {
    return null
  }
  return rel.split(path.sep).join('/')
}

/**
 * A workspace file whose path ends with `relative`: `data-lg-source` paths are
 * relative to the dev server's root, which may be a subfolder of the workspace.
 * Only unambiguous matches count.
 */
export async function findBySuffix(root: string, relative: string): Promise<string | null> {
  const suffix = relative.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!suffix || suffix.split('/').includes('..')) return null
  const matches = (await listFiles(root)).filter((f) => f === suffix || f.endsWith(`/${suffix}`))
  return matches.length === 1 ? matches[0]! : null
}

/** `previewUrl` from `<workspace>/.lookingglass/settings.json`, if it's an http(s) URL. */
export async function previewUrl(root: string): Promise<string | null> {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(root, '.lookingglass', 'settings.json'), 'utf8'))
    const url = settings?.previewUrl
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null
  } catch {
    return null
  }
}

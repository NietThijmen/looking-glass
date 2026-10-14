import path from 'node:path'

/**
 * Resolve `requestPath` against `root` and return the absolute path, or `null`
 * if the result would escape `root`. Does not touch the filesystem, so callers
 * that care about symlinks must `realpath` the result themselves.
 */
export function resolveInside(root: string, requestPath: string): string | null {
  const absRoot = path.resolve(root)
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const resolved = path.resolve(absRoot, '.' + path.sep + decoded)
  const relative = path.relative(absRoot, resolved)
  if (relative === '') return resolved
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

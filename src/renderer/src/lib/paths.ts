/** Workspace paths are POSIX-style and relative ("src/app.ts"; "" is the root). */

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Every ancestor directory of `path`, root first: "a/b/c.ts" → ["", "a", "a/b"]. */
export function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  const result = ['']
  for (let i = 0; i < parts.length; i++) result.push(parts.slice(0, i + 1).join('/'))
  return result
}

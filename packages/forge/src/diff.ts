import type { PullRequestFileStatus } from '@lookingglass/shared/forge'

export interface SplitPatch {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
  patch: string
}

/** Split `gh pr diff` output into one patch per file. */
export function splitDiff(diff: string): Map<string, SplitPatch> {
  const files = new Map<string, SplitPatch>()
  const starts = [...diff.matchAll(/^diff --git /gm)]
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!.index ?? 0
    const end = i + 1 < starts.length ? (starts[i + 1]!.index ?? diff.length) : diff.length
    const patch = diff.slice(start, end)
    const header = patch.split('\n', 1)[0]?.replace(/\r$/, '') ?? ''
    const paths = gitPaths(header)
    if (!paths) continue
    const path = paths.newPath === '/dev/null' ? paths.oldPath : paths.newPath
    if (!path || path === '/dev/null') continue
    const { additions, deletions } = countEdits(patch)
    files.set(path, { path, status: fileStatus(patch), additions, deletions, patch })
  }
  return files
}

function fileStatus(patch: string): PullRequestFileStatus {
  const header = patch.split('\n@@', 1)[0] ?? patch
  if (/^new file mode /m.test(header)) return 'added'
  if (/^deleted file mode /m.test(header)) return 'deleted'
  if (/^rename from /m.test(header)) return 'renamed'
  return 'modified'
}

function countEdits(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

function gitPaths(header: string): { oldPath: string; newPath: string } | null {
  const rest = header.startsWith('diff --git ') ? header.slice('diff --git '.length) : header
  const args = splitGitArgs(rest)
  const oldPath = args[0]
  const newPath = args[1]
  if (!oldPath || !newPath) return null
  return { oldPath: stripSide(oldPath), newPath: stripSide(newPath) }
}

function stripSide(path: string): string {
  if (path === '/dev/null') return path
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

function splitGitArgs(header: string): string[] {
  const args: string[] = []
  let i = 0
  while (i < header.length) {
    while (header[i] === ' ') i++
    if (i >= header.length) break
    if (header[i] === '"') {
      const quoted = readQuoted(header, i)
      args.push(quoted.value)
      i = quoted.next
      continue
    }
    const end = header.indexOf(' ', i)
    args.push(end === -1 ? header.slice(i) : header.slice(i, end))
    i = end === -1 ? header.length : end
  }
  return args
}

function readQuoted(header: string, start: number): { value: string; next: number } {
  let raw = '"'
  let i = start + 1
  while (i < header.length) {
    const ch = header[i]!
    raw += ch
    if (ch === '\\' && i + 1 < header.length) {
      raw += header[i + 1]!
      i += 2
      continue
    }
    if (ch === '"') return { value: unquoteGitPath(raw), next: i + 1 }
    i++
  }
  return { value: unquoteGitPath(raw), next: header.length }
}

function unquoteGitPath(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value
  let out = ''
  const inner = value.slice(1, -1)
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = inner[++i]
    if (next === undefined) break
    if (next === 'n') out += '\n'
    else if (next === 't') out += '\t'
    else out += next
  }
  return out
}

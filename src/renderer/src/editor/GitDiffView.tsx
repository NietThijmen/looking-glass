import { MultiFileDiff, Virtualizer } from '@pierre/diffs/react'
import { useEffect, useState } from 'react'
import { useEditor } from '../store/editor'
import { useWorkspace } from '../store/workspace'
import { baseOptions } from './diffsConfig'

const diffOptions = { ...baseOptions, diffStyle: 'unified' } as const

/** Read-only HEAD ↔ working copy diff (working copy includes unsaved edits). */
export function GitDiffView({ path }: { path: string }) {
  const draft = useEditor((s) => s.buffers[path]?.draft)
  const gitVersion = useWorkspace((s) => s.git)
  const [head, setHead] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.lookingglass.git
      .headContents(path)
      .then((contents) => !cancelled && setHead(contents))
      .catch(() => !cancelled && setHead(null))
    return () => {
      cancelled = true
    }
  }, [path, gitVersion])

  if (head === undefined) return <div className="p-4 text-muted">Loading diff…</div>

  const current = draft ?? ''
  if (head === current) return <div className="p-4 text-muted">No changes against HEAD.</div>

  return (
    <div className="h-full" data-testid="diff-view" data-path={path}>
      <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full">
        <MultiFileDiff
          oldFile={{ name: path, contents: head ?? '' }}
          newFile={{ name: path, contents: current }}
          options={diffOptions}
        />
      </Virtualizer>
    </div>
  )
}

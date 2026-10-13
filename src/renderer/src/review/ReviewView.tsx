import { MultiFileDiff, Virtualizer, type DiffLineAnnotation } from '@pierre/diffs/react'
import { useEffect, useMemo, useState } from 'react'
import { baseOptions } from '../editor/diffsConfig'
import { useReview } from '../store/review'
import { Check, Icon, X, iconSize } from '../ui/icon'
import { acceptBlock, changeBlocks, rejectBlock, segments } from './hunks'

const diffOptions = { ...baseOptions, diffStyle: 'unified' } as const

interface Loaded {
  base: string
  current: string
}

async function load(path: string): Promise<Loaded> {
  const [base, current] = await Promise.all([
    window.lookingglass.review.base(path),
    window.lookingglass.fs.readFile(path).then(
      (f) => f.contents,
      () => '',
    ),
  ])
  return { base: base ?? '', current }
}

function HunkActions({ onAccept, onReject }: { onAccept(): void; onReject(): void }) {
  return (
    <div className="flex gap-1.5 px-3 py-1 font-sans text-[11px]" data-testid="hunk-actions">
      <button
        data-testid="hunk-accept"
        onClick={onAccept}
        className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 text-emerald-300 hover:bg-emerald-500/30"
      >
        <Icon icon={Check} className={iconSize.xs} />
        Keep
      </button>
      <button
        data-testid="hunk-reject"
        onClick={onReject}
        className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 text-red-300 hover:bg-red-500/25"
      >
        <Icon icon={X} className={iconSize.xs} />
        Undo
      </button>
    </div>
  )
}

/** Agent changes to one file against its review baseline, with per-hunk keep/undo. */
export function ReviewView({ path }: { path: string }) {
  const entry = useReview((s) => s.entries.find((e) => e.path === path))
  const version = useReview((s) => s.version)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    void load(path).then((l) => !cancelled && setLoaded(l))
    return () => {
      cancelled = true
    }
  }, [path, version])

  const blocks = useMemo(() => (loaded ? changeBlocks(segments(loaded.base, loaded.current)) : []), [loaded])
  const annotations = useMemo<DiffLineAnnotation<{ block: number }>[]>(
    () =>
      blocks.map((b) =>
        b.newCount > 0
          ? { side: 'additions', lineNumber: b.newLine + b.newCount - 1, metadata: { block: b.index } }
          : { side: 'deletions', lineNumber: b.oldLine + b.oldCount - 1, metadata: { block: b.index } },
      ),
    [blocks],
  )

  if (!entry) return <div className="p-4 text-muted">No pending agent changes for {path}.</div>
  if (!loaded) return <div className="p-4 text-muted">Loading changes…</div>

  const { base, current } = loaded
  return (
    <div className="flex h-full flex-col" data-testid="review-view" data-path={path}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
        <span className="text-muted">
          Agent changes · {entry.status} · {blocks.length} {blocks.length === 1 ? 'hunk' : 'hunks'}
        </span>
        <span className="ml-auto" />
        <button
          data-testid="review-accept-file"
          onClick={() => void window.lookingglass.review.accept(path)}
          className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/30"
        >
          Keep file
        </button>
        <button
          data-testid="review-reject-file"
          onClick={() => void window.lookingglass.review.reject(path)}
          className="rounded bg-red-500/15 px-2 py-0.5 text-red-300 hover:bg-red-500/25"
        >
          Undo file
        </button>
      </div>
      <Virtualizer className="min-h-0 flex-1 overflow-auto" contentClassName="min-h-full">
        <MultiFileDiff<{ block: number }>
          oldFile={{ name: path, contents: base }}
          newFile={{ name: path, contents: current }}
          options={diffOptions}
          lineAnnotations={annotations}
          renderAnnotation={(annotation) => (
            <HunkActions
              onAccept={() =>
                void window.lookingglass.review.setBase(
                  path,
                  acceptBlock(base, current, annotation.metadata.block),
                )
              }
              onReject={() =>
                void window.lookingglass.review.writeCurrent(
                  path,
                  rejectBlock(base, current, annotation.metadata.block),
                )
              }
            />
          )}
        />
      </Virtualizer>
    </div>
  )
}

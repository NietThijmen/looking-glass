import { prepareFileTreeInput, type FileTreePreparedInput } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useWorkspace } from '../store/workspace'
import { toTreeGitEntries } from './treeGit'

const treeHostStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  // Follow the app chrome colours (styles.css), including the light theme.
  ['--trees-bg-override' as string]: 'var(--color-panel)',
  ['--trees-fg-override' as string]: 'var(--color-fg)',
  ['--trees-fg-muted-override' as string]: 'var(--color-muted)',
  ['--trees-accent-override' as string]: 'var(--color-accent)',
  ['--trees-selected-bg-override' as string]:
    'color-mix(in srgb, var(--color-accent) 18%, var(--color-panel))',
  ['--trees-border-color-override' as string]: 'var(--color-border)',
}

export function ExplorerTree() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)
  const filePaths = useWorkspace((s) => s.filePaths)
  const pendingReveal = useWorkspace((s) => s.pendingTreeReveal)
  const reviewEntries = useReview((s) => s.entries)
  const activePath = useEditor((s) => s.tabs.find((t) => t.id === s.activeId)?.path)

  const preparedInput = useMemo<FileTreePreparedInput | null>(
    () => (info && filePaths ? prepareFileTreeInput(filePaths, { flattenEmptyDirectories: true }) : null),
    [info, filePaths],
  )

  const reviewedPaths = useMemo(() => {
    const set = new Set<string>()
    for (const entry of reviewEntries) {
      set.add(entry.path)
      const slash = entry.path.lastIndexOf('/')
      if (slash > 0) {
        for (let i = slash; i > 0; i = entry.path.lastIndexOf('/', i - 1)) {
          const dir = entry.path.slice(0, i)
          if (dir) set.add(dir)
        }
      }
    }
    return set
  }, [reviewEntries])

  const modelRef = useRef<ReturnType<typeof useFileTree>['model'] | null>(null)
  const reviewedRef = useRef(reviewedPaths)
  useEffect(() => {
    reviewedRef.current = reviewedPaths
  }, [reviewedPaths])

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: 'closed',
    icons: 'standard',
    onSelectionChange: (selected) => {
      const path = selected[selected.length - 1]
      if (!path) return
      const item = modelRef.current?.getItem(path)
      if (item && !item.isDirectory()) void useEditor.getState().openFile(path)
    },
    renderRowDecoration: ({ item }) => {
      if (!reviewedRef.current.has(item.path)) return null
      return { text: 'review', title: 'Agent changes to review', color: '#fbbf24' }
    },
  })
  useEffect(() => {
    modelRef.current = model
  }, [model])

  useEffect(() => {
    if (!preparedInput) return
    model.resetPaths({ preparedInput })
  }, [model, preparedInput])

  useEffect(() => {
    model.setGitStatus(git ? toTreeGitEntries(git.entries) : undefined)
  }, [model, git])

  useEffect(() => {
    if (!pendingReveal) return
    model.scrollToPath(pendingReveal, { focus: true })
    useWorkspace.setState({ pendingTreeReveal: null })
  }, [model, pendingReveal])

  useEffect(() => {
    if (!activePath) return
    model.scrollToPath(activePath, { focus: false })
  }, [model, activePath])

  if (!info || !preparedInput) {
    return <div className="px-3 py-2 text-muted">Loading files…</div>
  }

  return (
    <FileTree
      model={model}
      data-testid="explorer"
      role="tree"
      className="min-h-0 flex-1"
      style={treeHostStyle}
    />
  )
}

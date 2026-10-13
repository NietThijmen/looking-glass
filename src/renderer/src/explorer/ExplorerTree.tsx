import { prepareFileTreeInput, type FileTreePreparedInput } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useWorkspace } from '../store/workspace'
import { toTreeGitEntries } from './treeGit'

const treeHostStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  // Align with app chrome / pierre-dark editor surface (see styles.css @theme).
  ['--trees-bg-override' as string]: '#171717',
  ['--trees-fg-override' as string]: '#fafafa',
  ['--trees-fg-muted-override' as string]: '#a3a3a3',
  ['--trees-accent-override' as string]: '#009fff',
  ['--trees-selected-bg-override' as string]: 'color-mix(in srgb, #009fff 18%, #171717)',
  ['--trees-border-color-override' as string]: '#262626',
}

export function ExplorerTree() {
  const info = useWorkspace((s) => s.info)
  const git = useWorkspace((s) => s.git)
  const filePaths = useWorkspace((s) => s.filePaths)
  const pendingReveal = useWorkspace((s) => s.pendingTreeReveal)
  const reviewEntries = useReview((s) => s.entries)
  const activePath = useEditor((s) => s.tabs.find((t) => t.id === s.activeId)?.path)

  const [preparedInput, setPreparedInput] = useState<FileTreePreparedInput | null>(null)
  const openFileRef = useRef<(path: string) => void>(() => undefined)
  openFileRef.current = (path) => void useEditor.getState().openFile(path)

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
  reviewedRef.current = reviewedPaths

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: 'closed',
    icons: 'standard',
    onSelectionChange: (selected) => {
      const path = selected[selected.length - 1]
      if (!path) return
      const item = modelRef.current?.getItem(path)
      if (item && !item.isDirectory()) openFileRef.current(path)
    },
    renderRowDecoration: ({ item }) => {
      if (!reviewedRef.current.has(item.path)) return null
      return { text: 'review', title: 'Agent changes to review', color: '#fbbf24' }
    },
  })
  modelRef.current = model

  useEffect(() => {
    if (!info) {
      setPreparedInput(null)
      return
    }
    if (filePaths) setPreparedInput(prepareFileTreeInput(filePaths, { flattenEmptyDirectories: true }))
  }, [info, filePaths])

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

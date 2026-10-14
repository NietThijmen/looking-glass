import type { EditorSnapshot } from '@lookingglass/shared/agent'
import { isDirty, useEditor } from '../store/editor'

const DEBOUNCE_MS = 150

function snapshot(): EditorSnapshot {
  const { lastCodeId, buffers } = useEditor.getState()
  // Browser, settings and chat tabs aren't files.
  const tabs = useEditor
    .getState()
    .tabs.filter((t) => t.kind === 'file' || t.kind === 'diff' || t.kind === 'review')
  const dirty: Record<string, string> = {}
  for (const [path, buffer] of Object.entries(buffers)) if (isDirty(buffer)) dirty[path] = buffer.draft
  return {
    openFiles: [...new Set(tabs.map((t) => t.path))],
    activeFile: tabs.find((t) => t.id === lastCodeId)?.path ?? null,
    dirty,
  }
}

/**
 * Keep main's view of the editor current, so agent file reads see unsaved
 * edits and editor MCP tools know what's open. Returns an unsubscribe.
 */
export function publishEditorSnapshots(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  const unsubscribe = useEditor.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const next = snapshot()
      const serialized = JSON.stringify(next)
      if (serialized === last) return
      last = serialized
      void window.lookingglass.editor.publishSnapshot(next)
    }, DEBOUNCE_MS)
  })
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}

import type { Editor } from '@pierre/diffs/edit'

/** Live editors by path, so other parts of the UI can ask for the current selection. */
const editors = new Map<string, Editor<'file'>>()

export function registerEditor(path: string, editor: Editor<'file'>): () => void {
  editors.set(path, editor)
  return () => {
    if (editors.get(path) === editor) editors.delete(path)
  }
}

export interface SelectionInfo {
  path: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  text: string
}

/** The first non-empty selection in `path`'s editor, if any. */
export function selectionIn(path: string): SelectionInfo | null {
  const editor = editors.get(path)
  if (!editor) return null
  const selection = editor
    .getViewState()
    .selections?.find((s) => s.start.line !== s.end.line || s.start.character !== s.end.character)
  if (!selection) return null
  const [start, end] =
    selection.start.line < selection.end.line ||
    (selection.start.line === selection.end.line && selection.start.character <= selection.end.character)
      ? [selection.start, selection.end]
      : [selection.end, selection.start]
  const lines = editor.getText().split('\n')
  const picked = lines.slice(start.line, end.line + 1)
  if (picked.length === 0) return null
  picked[picked.length - 1] = picked[picked.length - 1]!.slice(
    0,
    start.line === end.line ? end.character : end.character,
  )
  picked[0] = picked[0]!.slice(start.character)
  return { path, startLine: start.line + 1, endLine: end.line + 1, text: picked.join('\n') }
}

/** The selection in `path`'s editor, or the caret's whole line when nothing is selected. */
export function selectionOrLine(path: string): SelectionInfo | null {
  const selected = selectionIn(path)
  if (selected) return selected
  const editor = editors.get(path)
  const caret = editor?.getViewState().selections?.[0]?.start
  if (!editor || !caret) return null
  const text = editor.getText().split('\n')[caret.line] ?? ''
  return { path, startLine: caret.line + 1, endLine: caret.line + 1, text }
}

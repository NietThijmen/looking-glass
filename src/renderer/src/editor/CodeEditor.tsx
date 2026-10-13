import type { Editor, Marker } from '@pierre/diffs/edit'
import { File, Virtualizer, type FileOptions } from '@pierre/diffs/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runInlineEdit, useInlineEdit } from '../agent/inlineEdit'
import type { Diagnostic } from '../../../shared/diagnostics'
import { useDiagnostics } from '../store/diagnostics'
import { useEditor, type Buffer, type RevealTarget } from '../store/editor'
import { baseOptions } from './diffsConfig'
import { registerEditor } from './selection'

const fileOptions: FileOptions<undefined, undefined> = baseOptions

const NO_DIAGNOSTICS: Diagnostic[] = []

function toMarkers(diagnostics: Diagnostic[]): Marker[] {
  return diagnostics.map((d) => ({
    start: d.range.start,
    end: d.range.end,
    severity: d.severity,
    message: d.message,
    ...(d.source ? { source: d.code !== undefined ? `${d.source}(${d.code})` : d.source } : {}),
  }))
}

function reveal(editor: Editor<'file'>, target: RevealTarget): void {
  editor.focus({ lineNumber: target.line, character: target.column, offset: 80 })
}

/** The Cmd+K prompt over the editor: an instruction for the selected lines. */
function InlineEditBox({ path }: { path: string }) {
  const target = useInlineEdit((s) => (s.target?.path === path ? s.target : null))
  const [instruction, setInstruction] = useState('')
  if (!target) return null
  const lines =
    target.startLine === target.endLine
      ? `line ${target.startLine}`
      : `lines ${target.startLine}–${target.endLine}`
  const close = (): void => {
    setInstruction('')
    useInlineEdit.getState().close()
  }
  return (
    <div
      data-testid="inline-edit"
      className="absolute top-2 right-4 left-4 z-20 rounded border border-accent/60 bg-panel p-2 shadow-xl"
    >
      <div className="mb-1 text-[11px] text-muted">Edit {lines} with the agent</div>
      <input
        autoFocus
        data-testid="inline-edit-input"
        value={instruction}
        placeholder="Describe the change…  (Enter: run · Esc: cancel)"
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          } else if (e.key === 'Enter' && instruction.trim()) {
            e.preventDefault()
            void runInlineEdit(target, instruction.trim())
            close()
          }
        }}
        className="h-7 w-full rounded border border-border bg-bg px-2 outline-none select-text focus:border-accent"
      />
    </div>
  )
}

export function CodeEditor({ path, buffer }: { path: string; buffer: Buffer }) {
  const setDraft = useEditor((s) => s.setDraft)
  const pendingReveal = useEditor((s) => (s.reveal?.path === path ? s.reveal : null))
  const diagnostics = useDiagnostics((s) => s.byPath[path] ?? NO_DIAGNOSTICS)
  const editorRef = useRef<Editor<'file'> | null>(null)
  const unregisterRef = useRef<(() => void) | null>(null)
  useEffect(() => () => unregisterRef.current?.(), [])

  // The file and key only change when the buffer is replaced from disk, so an
  // edit session (and its undo history) survives re-renders and tab switches.
  const key = `${path}@${buffer.version}`
  const file = useMemo(() => ({ name: path, contents: buffer.base, cacheKey: key }), [path, buffer.base, key])

  const editorOptions = useMemo(
    () => ({
      onAttach: (editor: Editor<'file'>) => {
        editorRef.current = editor
        editor.setMarkers(toMarkers(useDiagnostics.getState().byPath[path] ?? NO_DIAGNOSTICS))
        unregisterRef.current?.()
        unregisterRef.current = registerEditor(path, editor)
        // Attach fires before the editable content is in the DOM; focusing now is a no-op.
        requestAnimationFrame(() => {
          if (editorRef.current !== editor) return
          const target = useEditor.getState().reveal
          if (target?.path === path) {
            useEditor.getState().consumeReveal()
            reveal(editor, target)
          } else {
            editor.focus({ preventScroll: true })
          }
        })
      },
    }),
    [path],
  )

  useEffect(() => {
    editorRef.current?.setMarkers(toMarkers(diagnostics))
  }, [diagnostics])

  // Reveal requests for a file whose editor is already attached.
  useEffect(() => {
    if (!pendingReveal || !editorRef.current) return
    useEditor.getState().consumeReveal()
    reveal(editorRef.current, pendingReveal)
  }, [pendingReveal])

  const onEditChange = useCallback(
    (event: { file: { contents: string } }) => setDraft(path, event.file.contents),
    [path, setDraft],
  )

  return (
    <div className="relative h-full">
      <InlineEditBox path={path} />
      <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full">
        <File
          key={key}
          file={file}
          options={fileOptions}
          edit
          editStateKey={key}
          editorOptions={editorOptions}
          onEditChange={onEditChange}
          // The draft lives in the store; keep whatever the editor had.
          onEditComplete={() => 'accept'}
        />
      </Virtualizer>
    </div>
  )
}

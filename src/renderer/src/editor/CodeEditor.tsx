import type { Editor } from '@pierre/diffs/edit'
import { File, Virtualizer, type FileOptions } from '@pierre/diffs/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditor, type Buffer, type RevealTarget } from '../store/editor'
import { baseOptions } from './diffsConfig'
import { registerEditor } from './selection'

const fileOptions: FileOptions<undefined, undefined> = baseOptions

function reveal(editor: Editor<'file'>, target: RevealTarget): void {
  editor.focus({ lineNumber: target.line, character: target.column, offset: 80 })
}

export function CodeEditor({ path, buffer }: { path: string; buffer: Buffer }) {
  const setDraft = useEditor((s) => s.setDraft)
  const pendingReveal = useEditor((s) => (s.reveal?.path === path ? s.reveal : null))
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
  )
}

import { useState } from 'react'
import { externalEditor } from '@lookingglass/shared/editors'
import { useSettings } from '../store/settings'
import { ExternalLink, Icon, iconSize } from '../ui/icon'

/** Opens a workspace file in the editor chosen in Settings; shows the launch error if it fails. */
export function OpenInEditorButton({
  path,
  line,
  column,
  className = 'text-muted hover:text-fg',
  label,
}: {
  path: string
  /** Where to jump to; may be computed on click. */
  line?: number | (() => number | undefined)
  column?: number
  className?: string
  label?: string
}) {
  const editorId = useSettings((s) => s.settings.externalEditor)
  const [error, setError] = useState<string | null>(null)
  const name = externalEditor(editorId).label

  const open = async (): Promise<void> => {
    setError(null)
    try {
      await window.lookingglass.app.openInEditor(path, typeof line === 'function' ? line() : line, column)
    } catch (e) {
      // Electron wraps IPC errors as "Error invoking remote method '…': Error: <message>".
      setError((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }

  return (
    <>
      <button
        data-testid="open-in-editor"
        title={error ?? `Open in ${name}`}
        aria-label={`Open in ${name}`}
        className={`inline-flex items-center gap-1 ${error ? 'text-red-400' : className}`}
        onClick={() => void open()}
      >
        <Icon icon={ExternalLink} className={iconSize.xs} />
        {label}
      </button>
      {error && (
        <span role="alert" className="max-w-xs truncate text-[11px] text-red-400" title={error}>
          {error}
        </span>
      )}
    </>
  )
}

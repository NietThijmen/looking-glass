import { EditorArea } from '../editor/EditorArea'
import { useUi } from '../store/ui'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { ResizeHandle } from './ResizeHandle'

/** One tabbed pane for browser, code and chat tabs, with the terminal below. */
export function Workbench() {
  const patchLayout = useUi((s) => s.patchLayout)
  const terminalOpen = useUi((s) => s.terminalOpen)
  const terminalHeight = useUi((s) => s.layout.terminalHeight)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <section data-testid="workbench" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
        <EditorArea />
      </section>
      {terminalOpen && (
        <ResizeHandle
          axis="vertical"
          data-testid="resize-terminal"
          onDelta={(delta) => patchLayout({ terminalHeight: terminalHeight + delta })}
        />
      )}
      <section
        style={{ height: terminalOpen ? terminalHeight : 0 }}
        className={`flex shrink-0 flex-col overflow-hidden border-t border-border bg-bg ${terminalOpen ? '' : 'hidden'}`}
        aria-hidden={!terminalOpen}
        data-testid="terminal-section"
      >
        <div className="min-h-0 flex-1">
          <TerminalPanel />
        </div>
      </section>
    </div>
  )
}

import { GripVertical } from 'lucide-react'
import { Fragment, type ReactNode, useMemo, useState } from 'react'
import { AgentPanel } from '../agent/AgentPanel'
import { EditorArea } from '../editor/EditorArea'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { Icon, iconSize } from '../ui/icon'
import { ResizeHandle } from './ResizeHandle'
import type { WorkbenchColumn } from './workbenchState'

const COLUMN_LABEL: Record<WorkbenchColumn, string> = {
  editor: 'Editor',
  agent: 'Agent',
  browser: 'Browser',
}

function ColumnGrip({
  column,
  onReorder,
}: {
  column: WorkbenchColumn
  onReorder(from: WorkbenchColumn, to: WorkbenchColumn): void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      title={`Drag to reorder · ${COLUMN_LABEL[column]}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lookingglass-column', column)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/lookingglass-column')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const from = e.dataTransfer.getData('text/lookingglass-column') as WorkbenchColumn
        if (from && from !== column) onReorder(from, column)
      }}
      className={`no-drag flex w-5 shrink-0 cursor-grab items-center justify-center border-r border-border active:cursor-grabbing ${
        over ? 'bg-accent/20' : 'text-muted hover:bg-white/5 hover:text-fg'
      }`}
    >
      <Icon icon={GripVertical} className={iconSize.sm} />
    </div>
  )
}

function ColumnShell({
  column,
  width,
  grow,
  bordered,
  onReorder,
  children,
}: {
  column: WorkbenchColumn
  width?: number
  grow?: boolean
  bordered?: boolean
  onReorder(from: WorkbenchColumn, to: WorkbenchColumn): void
  children: ReactNode
}) {
  return (
    <section
      data-testid={`workbench-${column}`}
      style={grow ? undefined : { width, flexShrink: 0 }}
      className={`flex min-h-0 min-w-0 flex-col border-border bg-bg ${grow ? 'min-w-[240px] flex-1' : ''} ${
        bordered ? 'border-l' : ''
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <ColumnGrip column={column} onReorder={onReorder} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </section>
  )
}

export function Workbench() {
  const layout = useUi((s) => s.layout)
  const patchLayout = useUi((s) => s.patchLayout)
  const reorderColumns = useUi((s) => s.reorderColumns)
  const terminalOpen = useUi((s) => s.terminalOpen)
  const terminalHeight = layout.terminalHeight
  const hasBrowserTabs = useEditor((s) => s.tabs.some((t) => t.kind === 'browser'))

  const visibleColumns = useMemo(() => {
    return layout.columnOrder.filter((col) => col !== 'browser' || hasBrowserTabs)
  }, [layout.columnOrder, hasBrowserTabs])

  const renderColumn = (column: WorkbenchColumn): ReactNode => {
    switch (column) {
      case 'editor':
        return <EditorArea kinds={['file', 'diff', 'review']} />
      case 'agent':
        return <AgentPanel />
      case 'browser':
        return <EditorArea kinds={['browser']} />
      default: {
        const _never: never = column
        return _never
      }
    }
  }

  /** Dragging the sash right/down gives space to the panel on the left (VS Code-style). */
  const resizeBetween = (left: WorkbenchColumn, right: WorkbenchColumn, delta: number): void => {
    if (left === 'agent') patchLayout({ agentWidth: layout.agentWidth + delta })
    else if (left === 'browser') patchLayout({ browserWidth: layout.browserWidth + delta })
    else if (right === 'agent') patchLayout({ agentWidth: layout.agentWidth - delta })
    else if (right === 'browser') patchLayout({ browserWidth: layout.browserWidth - delta })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        {visibleColumns.map((column, index) => {
          const grow = column === 'editor'
          const width =
            column === 'agent' ? layout.agentWidth : column === 'browser' ? layout.browserWidth : undefined
          return (
            <Fragment key={column}>
              {index > 0 && (
                <ResizeHandle
                  axis="horizontal"
                  data-testid={`resize-before-${column}`}
                  onDelta={(delta) => resizeBetween(visibleColumns[index - 1]!, column, delta)}
                />
              )}
              <ColumnShell
                column={column}
                width={width}
                grow={grow}
                bordered={index > 0}
                onReorder={(from, to) => reorderColumns(from, to)}
              >
                {renderColumn(column)}
              </ColumnShell>
            </Fragment>
          )
        })}
      </div>
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

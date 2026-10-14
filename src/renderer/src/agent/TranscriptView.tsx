import { MultiFileDiff } from '@pierre/diffs/react'
import type { ToolCallContent } from '@agentclientprotocol/sdk'
import { memo, useState } from 'react'
import { baseOptions } from '../editor/diffsConfig'
import { OpenInEditorButton } from '../editor/OpenInEditorButton'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import {
  Chevron,
  Icon,
  Paperclip,
  PlanStatusIcon,
  RotateCcw,
  Terminal,
  iconSize,
  toolKindIcon,
} from '../ui/icon'
import { Markdown } from './Markdown'
import { blockText, type PlanState, type ToolCallState, type TranscriptItem } from './transcript'

const statusStyle: Record<string, string> = {
  pending: 'text-muted',
  in_progress: 'text-accent',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
}

/** Turn an absolute agent path into a workspace path we can open, if it is inside. */
function useWorkspacePath(abs: string): string | null {
  const root = useWorkspace((s) => s.info?.root)
  if (!root || !abs.startsWith(root + '/')) return null
  return abs.slice(root.length + 1)
}

function Location({ path, line }: { path: string; line?: number | null }) {
  const rel = useWorkspacePath(path)
  const label = `${rel ?? path}${line ? `:${line}` : ''}`
  if (!rel) return <span className="font-mono text-[11px] text-muted">{label}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        className="font-mono text-[11px] text-accent hover:underline"
        onClick={() => void useEditor.getState().openFile(rel, line ? { line, column: 0 } : undefined)}
      >
        {label}
      </button>
      <OpenInEditorButton path={rel} line={line ?? undefined} />
    </span>
  )
}

const diffOptions = { ...baseOptions, diffStyle: 'unified', overflow: 'wrap' } as const

function ToolContent({ content }: { content: ToolCallContent }) {
  switch (content.type) {
    case 'content':
      return content.content.type === 'text' ? (
        <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-muted select-text">
          {content.content.text}
        </pre>
      ) : (
        <div className="text-[11px] text-muted">{blockText(content.content)}</div>
      )
    case 'diff':
      return (
        <div className="overflow-hidden rounded border border-border text-[11px]">
          <MultiFileDiff
            oldFile={{ name: content.path, contents: content.oldText ?? '' }}
            newFile={{ name: content.path, contents: content.newText }}
            options={diffOptions}
            disableWorkerPool
          />
        </div>
      )
    case 'terminal':
      return (
        <button
          className="text-[11px] text-accent hover:underline"
          onClick={() => useUi.getState().focusTerminal(content.terminalId)}
        >
          <span className="inline-flex items-center gap-1">
            <Icon icon={Terminal} className={iconSize.xs} />
            Show in terminal panel
          </span>
        </button>
      )
  }
}

function ToolCard({ call }: { call: ToolCallState }) {
  const [open, setOpen] = useState(false)
  const hasDetails = call.content.length > 0 || call.locations.length > 0
  return (
    <div
      className="rounded border border-border bg-panel"
      data-testid="tool-call"
      data-status={call.status ?? ''}
    >
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <Icon icon={toolKindIcon[call.kind ?? 'other']} className={`${iconSize.sm} text-muted`} />
        <span className="min-w-0 flex-1 truncate">{call.title}</span>
        <span className={`text-[10px] ${statusStyle[call.status ?? 'pending']}`}>
          {call.status === 'in_progress' ? 'running' : (call.status ?? 'pending')}
        </span>
        {hasDetails && <Chevron open={open} />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2 py-2">
          {call.locations.map((l, i) => (
            <div key={i}>
              <Location path={l.path} line={l.line} />
            </div>
          ))}
          {call.content.map((c, i) => (
            <ToolContent key={i} content={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanView({ plan }: { plan: PlanState }) {
  return (
    <div className="rounded border border-border bg-panel px-3 py-2" data-testid="plan">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Plan</div>
      {plan.type === 'entries' && (
        <ul className="space-y-0.5">
          {plan.entries.map((e, i) => (
            <li key={i} className={`flex gap-2 ${e.status === 'completed' ? 'text-muted line-through' : ''}`}>
              <span className={e.status === 'in_progress' ? 'text-accent' : 'text-muted'}>
                <PlanStatusIcon status={e.status} />
              </span>
              <span>{e.content}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.type === 'markdown' && <Markdown source={plan.content} />}
      {plan.type === 'file' && <div className="font-mono text-[11px] text-muted">{plan.uri}</div>}
    </div>
  )
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-muted">
      <button
        className="inline-flex items-center gap-1 text-[11px] italic hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron open={open} />
        Thinking
      </button>
      {open && (
        <div className="mt-1 border-l border-border pl-3 text-[12px] whitespace-pre-wrap select-text">
          {text}
        </div>
      )}
    </div>
  )
}

const stopLabel: Record<string, string> = {
  cancelled: 'Stopped',
  max_tokens: 'Stopped: hit the token limit',
  max_turn_requests: 'Stopped: hit the request limit',
  refusal: 'The agent refused',
}

const Item = memo(function Item({
  item,
  live,
  onRestore,
}: {
  item: TranscriptItem
  live: boolean
  onRestore(itemId: number): void
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="group relative ml-6 rounded-lg bg-fg/5 px-3 py-2" data-testid="user-message">
          {item.checkpoint && (
            <button
              data-testid="restore-checkpoint"
              title="Put files back the way they were before this message"
              onClick={() => {
                if (window.confirm('Restore all files to how they were before this message?'))
                  onRestore(item.id)
              }}
              className="absolute top-1 right-1 hidden rounded px-1.5 text-[10px] text-muted group-hover:block hover:bg-fg/10 hover:text-fg"
            >
              <span className="inline-flex items-center gap-0.5">
                <Icon icon={RotateCcw} className={iconSize.xs} />
                Restore
              </span>
            </button>
          )}
          <div className="whitespace-pre-wrap select-text">{item.text}</div>
          {item.attachments.length > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
              <Icon icon={Paperclip} className={iconSize.xs} />
              {item.attachments.join(', ')}
            </div>
          )}
        </div>
      )
    case 'agent':
      return (
        <div className="select-text" data-testid="agent-message">
          <Markdown source={item.text} live={live} />
        </div>
      )
    case 'thought':
      return <Thought text={item.text} />
    case 'tool':
      return <ToolCard call={item.call} />
    case 'plan':
      return <PlanView plan={item.plan} />
    case 'notice':
      return (
        <div className={`text-[12px] ${item.severity === 'error' ? 'text-red-400' : 'text-amber-300'}`}>
          {item.text}
        </div>
      )
    case 'turn-end':
      if (item.reason === 'end_turn') return null
      return (
        <div className={`text-[11px] ${item.reason === 'error' ? 'text-red-400' : 'text-muted'}`}>
          {item.reason === 'error' ? `Error: ${item.error}` : (stopLabel[item.reason] ?? item.reason)}
        </div>
      )
  }
})

export function TranscriptView({
  items,
  busy,
  onRestore,
}: {
  items: TranscriptItem[]
  busy: boolean
  onRestore(itemId: number): void
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <Item key={item.id} item={item} live={busy && i === items.length - 1} onRestore={onRestore} />
      ))}
    </div>
  )
}

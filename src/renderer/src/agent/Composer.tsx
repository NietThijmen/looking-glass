import { useEffect, useMemo, useRef, useState } from 'react'
import { basename } from '../lib/paths'
import { useAgents, type Attachment, type AttachmentPart, type Chat } from '../store/agents'
import { useEditor } from '../store/editor'
import {
  AtSign,
  Chevron,
  Crosshair,
  Icon,
  Image,
  Paperclip,
  X,
  iconSize,
  mentionOptionIcon,
} from '../ui/icon'
import { ComposerHints } from '../git/ComposerHints'
import { imageAttachment, mentionOptions, optionLabel, resolveMention, type MentionOption } from './mentions'

/** `@query` right before the caret, if the user is typing a mention. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null
}

const PREVIEW_CHARS = 600

/** What a part would send, shortened for the preview. */
function PartPreview({ part }: { part: AttachmentPart }) {
  const block = part.blocks[0]
  if (block?.type === 'image')
    return (
      <img
        src={`data:${block.mimeType};base64,${block.data}`}
        alt=""
        className="max-h-24 max-w-full rounded border border-border object-contain"
      />
    )
  const text = part.blocks
    .map((b) => (b.type === 'text' ? b.text : b.type === 'resource_link' ? b.uri : ''))
    .join('\n')
  if (!text) return null
  return (
    <pre className="max-h-24 overflow-auto rounded bg-bg px-1.5 py-1 font-mono text-[10px] whitespace-pre-wrap text-muted select-text">
      {text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text}
    </pre>
  )
}

/** The parts of an attachment, each with a tick box and a preview of what it sends. */
function PartsPanel({ attachment, onToggle }: { attachment: Attachment; onToggle(index: number): void }) {
  return (
    <div
      data-testid="attachment-parts"
      className="mb-1.5 rounded border border-border bg-panel p-1.5 text-[11px]"
    >
      {attachment.parts?.map((part, i) => (
        <div key={i} className="mb-1 last:mb-0">
          <label className={`flex items-center gap-1.5 ${part.locked ? 'text-muted' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              data-testid="attachment-part"
              data-label={part.label}
              checked={part.on || !!part.locked}
              disabled={part.locked}
              onChange={() => onToggle(i)}
            />
            {part.label}
            {part.locked && <span className="text-muted">(always sent)</span>}
          </label>
          {(part.on || part.locked) && (
            <div className="mt-0.5 ml-5">
              <PartPreview part={part} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function Composer({ chat }: { chat: Chat }) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachActive, setAttachActive] = useState(true)
  /** The attachment whose parts are shown for ticking. */
  const [expanded, setExpanded] = useState<number | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeFile = useEditor(
    (s) => s.tabs.find((t) => t.id === s.lastCodeId && t.kind === 'file')?.path ?? null,
  )
  const { send, cancel, setMode } = useAgents.getState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const ready = chat.state === 'ready'
  const caps = chat.promptCapabilities

  useEffect(() => {
    if (ready) ref.current?.focus()
  }, [ready, chat.key])

  // Pick up attachments sent here from elsewhere (browser element picker, console).
  const pendingCount = useAgents((s) => s.pending[chat.key]?.length ?? 0)
  useEffect(() => {
    if (!pendingCount) return
    const taken = useAgents.getState().takePending(chat.key)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- moving external queue into local state
    setAttachments((a) => [...a, ...taken])
    ref.current?.focus()
  }, [pendingCount, chat.key])

  const mention = mentionQuery(text, caret)
  const open = mention !== null && dismissedAt !== mention.start
  // Load the file list the first time a mention is typed.
  useEffect(() => {
    if (open && files === null) void window.lookingglass.fs.listFiles().then(setFiles, () => setFiles([]))
  }, [open, files])
  const options = useMemo(
    () => (open && mention ? mentionOptions(mention.query, files ?? []) : []),
    [open, mention?.query, files], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const pick = async (option: MentionOption): Promise<void> => {
    if (!mention) return
    const next = text.slice(0, mention.start) + text.slice(caret)
    setText(next)
    setCaret(mention.start)
    setHighlight(0)
    const resolved = await resolveMention(option, caps)
    if ('error' in resolved) setError(resolved.error)
    else {
      setError(null)
      setAttachments((a) => [...a, resolved])
    }
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(mention.start, mention.start)
    })
  }

  const addImages = async (list: Iterable<File>): Promise<boolean> => {
    const images = [...list].filter((f) => f.type.startsWith('image/'))
    if (!images.length) return false
    if (!caps.image) {
      setError("This agent doesn't accept images.")
      return true
    }
    const added = await Promise.all(images.map(imageAttachment))
    setAttachments((a) => [...a, ...added])
    return true
  }

  const submit = async (): Promise<void> => {
    if (!ready || chat.busy || (!text.trim() && !attachments.length)) return
    const all = [...attachments]
    if (attachActive && activeFile && !all.some((a) => a.label === basename(activeFile))) {
      const resolved = await resolveMention({ kind: 'file', path: activeFile }, caps)
      if (!('error' in resolved)) all.push(resolved)
    }
    void send(chat.key, text, all)
    setText('')
    setAttachments([])
    setExpanded(null)
    setError(null)
  }

  return (
    <div className="relative border-t border-border p-2">
      {open && options.length > 0 && (
        <div
          data-testid="mention-menu"
          className="absolute right-2 bottom-full left-2 z-10 mb-1 max-h-72 overflow-auto rounded border border-border bg-panel py-1 shadow-xl"
        >
          {options.map((option, i) => (
            <button
              key={`${option.kind}:${optionLabel(option)}`}
              data-testid="mention-option"
              data-label={optionLabel(option)}
              onMouseDown={(e) => {
                e.preventDefault()
                void pick(option)
              }}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left ${i === highlight ? 'bg-accent/20' : 'hover:bg-fg/5'}`}
            >
              <Icon icon={mentionOptionIcon[option.kind]} className={`${iconSize.sm} text-muted`} />
              <span className="truncate font-mono text-[12px]">{optionLabel(option)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-1.5 flex flex-wrap gap-1">
        {activeFile && (
          <button
            title="Attach the active file to your message"
            onClick={() => setAttachActive((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
              attachActive ? 'border-accent/50 text-fg' : 'border-border text-muted line-through'
            }`}
          >
            <Icon icon={Paperclip} className={iconSize.xs} />
            {basename(activeFile)}
          </button>
        )}
        {attachments.map((a, i) => {
          const sent = a.parts?.filter((p) => p.on || p.locked).length
          return (
            <span
              key={i}
              data-testid="attachment"
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
                expanded === i ? 'border-accent bg-accent/10' : 'border-accent/50'
              }`}
            >
              <Icon
                icon={a.parts ? Crosshair : a.blocks[0]?.type === 'image' ? Image : AtSign}
                className={iconSize.xs}
              />
              {a.parts ? (
                <button
                  data-testid="attachment-expand"
                  title="Choose what to send"
                  aria-expanded={expanded === i}
                  className="inline-flex items-center gap-1"
                  onClick={() => setExpanded((e) => (e === i ? null : i))}
                >
                  {a.label}
                  <span className="text-muted">
                    {sent}/{a.parts.length}
                  </span>
                  <Chevron open={expanded === i} />
                </button>
              ) : (
                a.label
              )}
              <button
                aria-label="Remove"
                onClick={() => {
                  setAttachments((list) => list.filter((_, j) => j !== i))
                  setExpanded((e) => (e === null || e < i ? e : e === i ? null : e - 1))
                }}
              >
                <Icon icon={X} className={iconSize.sm} />
              </button>
            </span>
          )
        })}
      </div>
      {expanded !== null && attachments[expanded]?.parts && (
        <PartsPanel
          attachment={attachments[expanded]}
          onToggle={(index) =>
            setAttachments((list) =>
              list.map((a, j) =>
                j === expanded && a.parts
                  ? { ...a, parts: a.parts.map((p, k) => (k === index ? { ...p, on: !p.on } : p)) }
                  : a,
              ),
            )
          }
        />
      )}

      <ComposerHints />
      <textarea
        ref={ref}
        data-testid="composer"
        value={text}
        disabled={!ready}
        placeholder={
          ready ? 'Ask anything…  @ to mention files, selection, terminal, git diff, ci' : 'Starting agent…'
        }
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          setHighlight(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={(e) => {
          const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
          if (!images.length) return
          e.preventDefault()
          void addImages(images)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void addImages(e.dataTransfer.files)
        }}
        onKeyDown={(e) => {
          if (open && options.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setHighlight((h) => (h + step + options.length) % options.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              void pick(options[highlight] ?? options[0]!)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDismissedAt(mention!.start)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={3}
        className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 outline-none select-text focus:border-accent disabled:opacity-50"
      />
      {error && <div className="mt-1 text-[11px] text-amber-300">{error}</div>}
      <div className="mt-1.5 flex items-center gap-2">
        {chat.modes && chat.modes.availableModes.length > 1 && (
          <select
            value={chat.modes.currentModeId}
            onChange={(e) => void setMode(chat.key, e.target.value)}
            className="rounded border border-border bg-bg px-1 py-0.5 text-[11px] text-muted outline-none"
          >
            {chat.modes.availableModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto" />
        {chat.busy ? (
          <button
            data-testid="stop"
            onClick={() => void cancel(chat.key)}
            className="rounded border border-border px-3 py-0.5 hover:bg-fg/5"
          >
            Stop
          </button>
        ) : (
          <button
            data-testid="send"
            disabled={!ready || (!text.trim() && !attachments.length)}
            onClick={() => void submit()}
            className="rounded bg-accent px-3 py-0.5 text-bg disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { basename } from '../lib/paths'
import { useAgents, type Attachment, type Chat } from '../store/agents'
import { useEditor } from '../store/editor'
import { AtSign, Icon, Image, Paperclip, X, iconSize, mentionOptionIcon } from '../ui/icon'
import { imageAttachment, mentionOptions, optionLabel, resolveMention, type MentionOption } from './mentions'

/** `@query` right before the caret, if the user is typing a mention. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null
}

export function Composer({ chat }: { chat: Chat }) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachActive, setAttachActive] = useState(true)
  const [files, setFiles] = useState<string[] | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeFile = useEditor(
    (s) => s.tabs.find((t) => t.id === s.activeId && t.kind === 'file')?.path ?? null,
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
              className={`flex w-full items-center gap-2 px-2 py-1 text-left ${i === highlight ? 'bg-accent/20' : 'hover:bg-white/5'}`}
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
        {attachments.map((a, i) => (
          <span
            key={i}
            data-testid="attachment"
            className="flex items-center gap-1 rounded border border-accent/50 px-1.5 py-0.5 text-[11px]"
          >
            {a.blocks[0]?.type === 'image' ? (
              <Icon icon={Image} className={iconSize.xs} />
            ) : (
              <Icon icon={AtSign} className={iconSize.xs} />
            )}
            {a.label}
            <button
              aria-label="Remove"
              onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
            >
              <Icon icon={X} className={iconSize.sm} />
            </button>
          </span>
        ))}
      </div>

      <textarea
        ref={ref}
        data-testid="composer"
        value={text}
        disabled={!ready}
        placeholder={
          ready ? 'Ask anything…  @ to mention files, selection, terminal, git diff' : 'Starting agent…'
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
            className="rounded border border-border px-3 py-0.5 hover:bg-white/5"
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

import type { ContentBlock } from '@agentclientprotocol/sdk'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { basename } from '../lib/paths'
import { useAgents, type Chat } from '../store/agents'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { TranscriptView } from './TranscriptView'

function PermissionCards({ sessionId }: { sessionId: string }) {
  const all = useAgents((s) => s.permissions)
  const requests = Object.values(all).filter((p) => p.sessionId === sessionId)
  const respond = useAgents((s) => s.respondPermission)
  return requests.map((request) => (
    <div
      key={request.requestId}
      data-testid="permission-request"
      className="rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2"
    >
      <div className="text-[11px] tracking-wide text-amber-300 uppercase">Permission needed</div>
      <div className="mt-0.5 mb-2">{request.toolCall.title ?? 'The agent wants to run a tool'}</div>
      <div className="flex flex-wrap gap-1.5">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            data-testid="permission-option"
            data-option-id={option.optionId}
            onClick={() => respond(request.requestId, option.optionId)}
            className={`rounded px-2 py-0.5 text-[12px] ${
              option.kind.startsWith('allow') ? 'bg-accent text-bg' : 'border border-border hover:bg-white/5'
            }`}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  ))
}

function AuthView({ chat }: { chat: Chat }) {
  const { retryChat } = useAgents.getState()
  const [error, setError] = useState<string | null>(null)
  if (!chat.auth) return null
  return (
    <div className="space-y-2 p-3">
      <div className="text-fg">This agent needs you to log in.</div>
      <div className="text-[12px] text-muted">{chat.auth.message}</div>
      {chat.auth.methods.map((method) => (
        <button
          key={method.id}
          className="block w-full rounded border border-border px-3 py-1.5 text-left hover:bg-white/5"
          onClick={async () => {
            setError(null)
            try {
              if ('type' in method && method.type === 'terminal') {
                await window.lookingglass.agent.startTerminalAuth(chat.agentId, method.id)
                if (!useUi.getState().terminalOpen) useUi.getState().toggleTerminal()
              } else {
                await window.lookingglass.agent.authenticate(chat.agentId, method.id)
                await retryChat(chat.key)
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          <div>{method.name}</div>
          {method.description && <div className="text-[11px] text-muted">{method.description}</div>}
        </button>
      ))}
      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <button className="text-[12px] text-accent hover:underline" onClick={() => void retryChat(chat.key)}>
        I've logged in, retry
      </button>
    </div>
  )
}

function Composer({ chat }: { chat: Chat }) {
  const [text, setText] = useState('')
  const [attachActive, setAttachActive] = useState(true)
  const activeFile = useEditor(
    (s) => s.tabs.find((t) => t.id === s.activeId && t.kind === 'file')?.path ?? null,
  )
  const root = useWorkspace((s) => s.info?.root)
  const { send, cancel, setMode } = useAgents.getState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const ready = chat.state === 'ready'

  useEffect(() => {
    if (ready) ref.current?.focus()
  }, [ready, chat.key])

  const submit = (): void => {
    if (!ready || chat.busy || !text.trim()) return
    const attachments: ContentBlock[] =
      attachActive && activeFile && root
        ? [{ type: 'resource_link', uri: `file://${root}/${activeFile}`, name: activeFile }]
        : []
    void send(chat.key, text, attachments)
    setText('')
  }

  return (
    <div className="border-t border-border p-2">
      {activeFile && (
        <button
          title="Attach the active file to your message"
          onClick={() => setAttachActive((v) => !v)}
          className={`mb-1.5 rounded border px-1.5 py-0.5 text-[11px] ${
            attachActive ? 'border-accent/50 text-fg' : 'border-border text-muted line-through'
          }`}
        >
          📎 {basename(activeFile)}
        </button>
      )}
      <textarea
        ref={ref}
        data-testid="composer"
        value={text}
        disabled={!ready}
        placeholder={ready ? 'Ask anything…  (Enter to send, Shift+Enter for a new line)' : 'Starting agent…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        rows={3}
        className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 outline-none select-text focus:border-accent disabled:opacity-50"
      />
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
            disabled={!ready || !text.trim()}
            onClick={submit}
            className="rounded bg-accent px-3 py-0.5 text-bg disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}

function ChatView({ chat }: { chat: Chat }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Follow new output unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="chat"
      data-state={chat.state}
      data-busy={chat.busy}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      >
        {chat.state === 'starting' && <div className="text-muted">Starting agent…</div>}
        {chat.state === 'error' && (
          <div className="space-y-2">
            <pre className="max-h-64 overflow-auto text-[11px] whitespace-pre-wrap text-red-400 select-text">
              {chat.error}
            </pre>
            <button
              className="text-[12px] text-accent hover:underline"
              onClick={() => void useAgents.getState().retryChat(chat.key)}
            >
              Retry
            </button>
          </div>
        )}
        {chat.state === 'auth' && <AuthView chat={chat} />}
        <TranscriptView items={chat.items} busy={chat.busy} />
        {chat.sessionId && <PermissionCards sessionId={chat.sessionId} />}
        {chat.busy && <div className="text-[11px] text-muted">● working…</div>}
      </div>
      <Composer chat={chat} />
    </div>
  )
}

function NewChatMenu({ onClose }: { onClose(): void }) {
  const agents = useAgents((s) => s.agents)
  return (
    <div className="absolute top-full right-0 z-10 mt-1 w-56 rounded border border-border bg-panel py-1 shadow-xl">
      {agents.map((agent) => (
        <button
          key={agent.id}
          data-testid="new-chat-agent"
          data-agent-id={agent.id}
          onClick={() => {
            onClose()
            void useAgents.getState().newChat(agent.id)
          }}
          className="block w-full px-3 py-1.5 text-left hover:bg-white/5"
        >
          {agent.label}
        </button>
      ))}
    </div>
  )
}

export function AgentPanel() {
  const hasWorkspace = useWorkspace((s) => !!s.info)
  const chats = useAgents((s) => s.chats)
  const activeKey = useAgents((s) => s.activeKey)
  const agents = useAgents((s) => s.agents)
  const [menuOpen, setMenuOpen] = useState(false)
  const active = chats.find((c) => c.key === activeKey)
  const label = (id: string): string => agents.find((a) => a.id === id)?.label ?? id

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-bg" data-testid="agent-panel">
      <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {chats.map((chat, i) => (
            <div
              key={chat.key}
              onClick={() => useAgents.getState().activate(chat.key)}
              className={`group flex shrink-0 cursor-default items-center gap-1 rounded px-2 py-0.5 text-[12px] ${
                chat.key === activeKey ? 'bg-white/10 text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {chat.busy && <span className="text-accent">●</span>}
              <span>
                {label(chat.agentId)} {i + 1}
              </span>
              <button
                aria-label="Close chat"
                onClick={(e) => {
                  e.stopPropagation()
                  useAgents.getState().closeChat(chat.key)
                }}
                className="opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          data-testid="new-chat"
          disabled={!hasWorkspace}
          title="New chat"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-1.5 text-muted hover:text-fg disabled:opacity-40"
        >
          +
        </button>
        {menuOpen && <NewChatMenu onClose={() => setMenuOpen(false)} />}
      </div>

      {active ? (
        <ChatView key={active.key} chat={active} />
      ) : (
        <div className="space-y-3 p-4 text-muted">
          {hasWorkspace ? (
            <>
              <div>Start a chat with an agent:</div>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  data-testid="start-agent"
                  data-agent-id={agent.id}
                  onClick={() => void useAgents.getState().newChat(agent.id)}
                  className="block w-full rounded border border-border px-3 py-2 text-left text-fg hover:bg-white/5"
                >
                  {agent.label}
                </button>
              ))}
            </>
          ) : (
            <div>Open a folder to start a chat.</div>
          )}
        </div>
      )}
    </aside>
  )
}

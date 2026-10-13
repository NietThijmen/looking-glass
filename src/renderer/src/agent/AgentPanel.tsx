import { useLayoutEffect, useRef, useState } from 'react'
import { basename } from '../lib/paths'
import { useAgents, type Chat } from '../store/agents'
import { useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Composer } from './Composer'
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

function ChangesBar() {
  const entries = useReview((s) => s.entries)
  const [open, setOpen] = useState(false)
  if (!entries.length) return null
  const statusColor = {
    added: 'text-emerald-400',
    modified: 'text-amber-300',
    deleted: 'text-red-400',
  } as const
  return (
    <div className="border-t border-border bg-panel" data-testid="changes-bar">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button className="flex items-center gap-1 text-[12px]" onClick={() => setOpen((v) => !v)}>
          <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
          <span className="text-amber-300">✦</span> {entries.length} {entries.length === 1 ? 'file' : 'files'}{' '}
          changed
        </button>
        <span className="ml-auto" />
        <button
          data-testid="accept-all"
          onClick={() => void window.lookingglass.review.accept(null)}
          className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/30"
        >
          Keep all
        </button>
        <button
          data-testid="reject-all"
          onClick={() => void window.lookingglass.review.reject(null)}
          className="rounded bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/25"
        >
          Undo all
        </button>
      </div>
      {open && (
        <div className="max-h-48 overflow-auto pb-1">
          {entries.map((entry) => (
            <div
              key={entry.path}
              data-testid="change-entry"
              data-path={entry.path}
              className="group flex h-[22px] cursor-default items-center gap-1.5 px-3 hover:bg-white/5"
              onClick={() => useEditor.getState().openReview(entry.path)}
            >
              <span className={`truncate ${statusColor[entry.status]}`}>{basename(entry.path)}</span>
              <span className="truncate text-[11px] text-muted">{entry.path}</span>
              <span className="ml-auto hidden gap-1 group-hover:flex">
                <button
                  title="Keep"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.lookingglass.review.accept(entry.path)
                  }}
                  className="px-1 text-emerald-300"
                >
                  ✓
                </button>
                <button
                  title="Undo"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.lookingglass.review.reject(entry.path)
                  }}
                  className="px-1 text-red-300"
                >
                  ✗
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
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
        <TranscriptView
          items={chat.items}
          busy={chat.busy}
          onRestore={(itemId) => void useAgents.getState().restore(chat.key, itemId)}
        />
        {chat.sessionId && <PermissionCards sessionId={chat.sessionId} />}
        {chat.busy && <div className="text-[11px] text-muted">● working…</div>}
      </div>
      <ChangesBar />
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

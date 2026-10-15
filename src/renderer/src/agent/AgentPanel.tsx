import { useLayoutEffect, useRef, useState } from 'react'
import { basename } from '../lib/paths'
import { AppWindow, PanelLeft } from 'lucide-react'
import { useAgents, type Chat, type ChatPlacement } from '../store/agents'
import { useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { Check, Chevron, History, Icon, Plus, Sparkles, StatusDot, X, iconSize } from '../ui/icon'
import { Composer } from './Composer'
import { HistoryMenu } from './HistoryMenu'
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
      <div className="mt-0.5 mb-2">
        {request.subagent && <span className="text-muted">Sub-agent "{request.subagent}": </span>}
        {request.toolCall.title ?? 'The agent wants to run a tool'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            data-testid="permission-option"
            data-option-id={option.optionId}
            onClick={() => respond(request.requestId, option.optionId)}
            className={`rounded px-2 py-0.5 text-[12px] ${
              option.kind.startsWith('allow') ? 'bg-accent text-bg' : 'border border-border hover:bg-fg/5'
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
          className="block w-full rounded border border-border px-3 py-1.5 text-left hover:bg-fg/5"
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
          <Chevron open={open} />
          <Icon icon={Sparkles} className={`${iconSize.sm} text-amber-300`} />
          {entries.length} {entries.length === 1 ? 'file' : 'files'} changed
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
              className="group flex h-[22px] cursor-default items-center gap-1.5 px-3 hover:bg-fg/5"
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
                  <Icon icon={Check} className={iconSize.sm} />
                </button>
                <button
                  title="Undo"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.lookingglass.review.reject(entry.path)
                  }}
                  className="px-1 text-red-300"
                >
                  <Icon icon={X} className={iconSize.sm} />
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
        {chat.state === 'starting' && (
          <div className="text-muted">
            {chat.resumeId ? 'Loading the earlier session…' : 'Starting agent…'}
          </div>
        )}
        {chat.state === 'error' && (
          <div className="space-y-2">
            <pre className="max-h-64 overflow-auto text-[11px] whitespace-pre-wrap text-red-400 select-text">
              {chat.error}
            </pre>
            <button
              className="text-[12px] text-accent hover:underline"
              onClick={() => void useAgents.getState().retryChat(chat.key)}
            >
              {chat.resumeId ? 'Resume' : 'Retry'}
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
        {chat.busy && (
          <div className="flex items-center gap-1 text-[11px] text-muted">
            <StatusDot className="text-accent" />
            working…
          </div>
        )}
      </div>
      <ChangesBar />
      <Composer chat={chat} />
    </div>
  )
}

/** A chat's tab or header name: its title, or the agent's name and number. */
export function useChatLabel(chat: Chat | undefined): string {
  const agent = useAgents((s) => s.agents.find((a) => a.id === chat?.agentId)?.label)
  if (!chat) return 'Chat'
  return chat.title ?? `${agent ?? chat.agentId} ${chat.key}`
}

export function NewChatMenu({ placement, onClose }: { placement: ChatPlacement; onClose(): void }) {
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
            void useAgents.getState().newChat(agent.id, { placement })
          }}
          className="block w-full px-3 py-1.5 text-left hover:bg-fg/5"
        >
          {agent.label}
        </button>
      ))}
    </div>
  )
}

/** The agent list shown where no chat is open yet. */
export function StartChat({ placement, testId }: { placement: ChatPlacement; testId: string }) {
  const hasWorkspace = useWorkspace((s) => !!s.info)
  const agents = useAgents((s) => s.agents)
  if (!hasWorkspace) return <div className="text-muted">Open a folder to start a chat.</div>
  return (
    <div className="space-y-3 text-muted">
      <div>Start a chat with an agent:</div>
      {agents.map((agent) => (
        <button
          key={agent.id}
          data-testid={testId}
          data-agent-id={agent.id}
          onClick={() => void useAgents.getState().newChat(agent.id, { placement })}
          className="block w-full rounded border border-border px-3 py-2 text-left text-fg hover:bg-fg/5"
        >
          {agent.label}
        </button>
      ))}
    </div>
  )
}

const headerButton = 'rounded px-1.5 text-muted hover:text-fg disabled:opacity-40'

/** A chat open as a tab in the main pane. */
export function AgentTab({ chatKey }: { chatKey: number }) {
  const chat = useAgents((s) => s.chats.find((c) => c.key === chatKey))
  const label = useChatLabel(chat)
  if (!chat) return null
  return (
    <div className="flex h-full min-w-0 flex-col bg-bg" data-testid="agent-tab">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-muted" title={label}>
          {label}
        </span>
        <button
          data-testid="move-to-sidebar"
          title="Move to sidebar"
          onClick={() => useAgents.getState().moveToSidebar(chat.key)}
          className={headerButton}
        >
          <Icon icon={PanelLeft} className={iconSize.sm} />
        </button>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <ChatView key={chat.key} chat={chat} />
      </div>
    </div>
  )
}

/** The sidebar's Agents view: one chat that stays next to whatever tab is in front. */
export function AgentsSidebar() {
  const hasWorkspace = useWorkspace((s) => !!s.info)
  const chat = useAgents((s) => s.chats.find((c) => c.key === s.sidebarKey))
  const label = useChatLabel(chat)
  const [menu, setMenu] = useState<'new' | 'history' | null>(null)
  const toggle = (which: 'new' | 'history'): void => setMenu((m) => (m === which ? null : which))

  return (
    <aside className="flex h-full min-w-0 flex-col bg-bg" data-testid="agent-panel">
      <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] text-muted">
          {chat?.busy && <StatusDot className="text-accent" />}
          <span className="truncate" title={chat ? label : undefined}>
            {chat ? label : 'Agents'}
          </span>
        </span>
        {chat && (
          <>
            <button
              data-testid="move-to-tab"
              title="Open in a tab"
              onClick={() => useAgents.getState().moveToTab(chat.key)}
              className={headerButton}
            >
              <Icon icon={AppWindow} className={iconSize.sm} />
            </button>
            <button
              aria-label="Close chat"
              title="Close chat"
              onClick={() => useAgents.getState().closeChat(chat.key)}
              className={headerButton}
            >
              <Icon icon={X} className={iconSize.sm} />
            </button>
          </>
        )}
        <button
          data-testid="history"
          disabled={!hasWorkspace}
          title="Earlier sessions"
          onClick={() => toggle('history')}
          className={headerButton}
        >
          <Icon icon={History} className={iconSize.sm} />
        </button>
        <button
          data-testid="new-chat"
          disabled={!hasWorkspace}
          title="New chat in the sidebar"
          onClick={() => toggle('new')}
          className={headerButton}
        >
          <Icon icon={Plus} className={iconSize.sm} />
        </button>
        {menu === 'new' && <NewChatMenu placement="sidebar" onClose={() => setMenu(null)} />}
        {menu === 'history' && <HistoryMenu placement="sidebar" onClose={() => setMenu(null)} />}
      </div>

      {chat ? (
        <ChatView key={chat.key} chat={chat} />
      ) : (
        <div className="p-4">
          <StartChat placement="sidebar" testId="start-agent" />
          <div className="mt-4 text-[11px] text-muted">
            Browser questions go to this chat. Open more chats as tabs from the tab bar.
          </div>
        </div>
      )}
    </aside>
  )
}

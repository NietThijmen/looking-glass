import { useEffect, useState } from 'react'
import type { SessionHistory } from '../../../shared/agent'
import { useAgents } from '../store/agents'
import { Chevron, Icon, Loader2, iconSize } from '../ui/icon'

type Loaded = SessionHistory | { error: string }

function when(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** One agent's past sessions, loaded on first expand (listing starts the agent). */
function AgentHistory({
  agentId,
  label,
  initiallyOpen,
  onPick,
}: {
  agentId: string
  label: string
  initiallyOpen: boolean
  onPick(): void
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!open || loaded) return
    let live = true
    void window.lookingglass.agent.listSessions(agentId).then(
      (history) => live && setLoaded(history),
      (error: unknown) =>
        live && setLoaded({ error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      live = false
    }
  }, [open, loaded, agentId])

  return (
    <div data-testid="history-agent" data-agent-id={agentId}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-1 text-left text-[11px] tracking-wide text-muted uppercase hover:text-fg"
      >
        <Chevron open={open} />
        {label}
      </button>
      {open && (
        <div className="pb-1">
          {loaded === null && (
            <div className="flex items-center gap-1 px-5 py-1 text-muted">
              <Icon icon={Loader2} className={`${iconSize.xs} animate-spin`} /> Loading…
            </div>
          )}
          {loaded && 'error' in loaded && (
            <div className="px-5 py-1 text-[11px] break-words text-red-400">{loaded.error}</div>
          )}
          {loaded && 'supported' in loaded && !loaded.supported && (
            <div className="px-5 py-1 text-muted">This agent doesn't keep a session history.</div>
          )}
          {loaded && 'supported' in loaded && loaded.supported && (
            <>
              {loaded.sessions.length === 0 && (
                <div className="px-5 py-1 text-muted">No earlier sessions in this folder.</div>
              )}
              {loaded.sessions.map((s) => (
                <button
                  key={s.sessionId}
                  data-testid="history-session"
                  data-session-id={s.sessionId}
                  title={s.title ?? s.sessionId}
                  onClick={() => {
                    onPick()
                    void useAgents.getState().openSession(agentId, s.sessionId, s.title)
                  }}
                  className="block w-full px-5 py-1 text-left hover:bg-fg/5"
                >
                  <div className="truncate text-fg">{s.title || 'Untitled session'}</div>
                  {s.updatedAt && <div className="text-[11px] text-muted">{when(s.updatedAt)}</div>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Past sessions, per agent, from each agent's own history (`session/list`). */
export function HistoryMenu({ onClose }: { onClose(): void }) {
  const agents = useAgents((s) => s.agents)
  const defaultAgentId = useAgents((s) => s.defaultAgentId)
  return (
    <div
      data-testid="history-menu"
      className="absolute top-full right-0 z-10 mt-1 max-h-96 w-72 overflow-auto rounded border border-border bg-panel py-1 shadow-xl"
    >
      {agents.map((agent) => (
        <AgentHistory
          key={agent.id}
          agentId={agent.id}
          label={agent.label}
          initiallyOpen={agent.id === defaultAgentId}
          onPick={onClose}
        />
      ))}
    </div>
  )
}

import type { SessionModeState } from '@agentclientprotocol/sdk'
import { create } from 'zustand'
import type {
  AgentStatus,
  AgentSummary,
  AuthRequired,
  ContentBlock,
  PermissionRequest,
  SessionUpdate,
} from '../../../shared/agent'
import { applyUpdate, turnEnd, userItem, type TranscriptItem } from '../agent/transcript'

export type ChatState = 'starting' | 'auth' | 'ready' | 'error'

export interface Chat {
  key: number
  agentId: string
  sessionId: string | null
  state: ChatState
  error?: string
  auth?: AuthRequired
  items: TranscriptItem[]
  busy: boolean
  modes: SessionModeState | null
}

interface AgentsStore {
  agents: AgentSummary[]
  statuses: Record<string, AgentStatus>
  chats: Chat[]
  activeKey: number | null
  /** Open permission requests by requestId. */
  permissions: Record<string, PermissionRequest>
  defaultAgentId: string

  loadAgents(): Promise<void>
  newChat(agentId?: string): Promise<void>
  retryChat(key: number): Promise<void>
  closeChat(key: number): void
  activate(key: number): void
  send(key: number, text: string, attachments: ContentBlock[]): Promise<void>
  cancel(key: number): Promise<void>
  setMode(key: number, modeId: string): Promise<void>
  respondPermission(requestId: string, optionId: string | null): void

  applyUpdate(sessionId: string, update: SessionUpdate): void
  setStatus(agentId: string, status: AgentStatus): void
  addPermission(request: PermissionRequest): void
  removePermission(requestId: string): void
  reset(): void
}

let nextKey = 1

export const useAgents = create<AgentsStore>((set, get) => {
  const patch = (key: number, update: Partial<Chat> | ((chat: Chat) => Partial<Chat>)): void =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.key === key ? { ...c, ...(typeof update === 'function' ? update(c) : update) } : c,
      ),
    }))

  async function startSession(key: number): Promise<void> {
    const chat = get().chats.find((c) => c.key === key)
    if (!chat) return
    patch(key, { state: 'starting', error: undefined, auth: undefined })
    try {
      const result = await window.lookingglass.agent.newSession(chat.agentId)
      if ('authRequired' in result) {
        patch(key, { state: 'auth', auth: result })
      } else {
        patch(key, { state: 'ready', sessionId: result.sessionId, modes: result.modes ?? null })
      }
    } catch (error) {
      patch(key, { state: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    agents: [],
    statuses: {},
    chats: [],
    activeKey: null,
    permissions: {},
    defaultAgentId: 'claude-code',

    async loadAgents() {
      const agents = await window.lookingglass.agent.list()
      set((s) => ({
        agents,
        defaultAgentId: agents.some((a) => a.id === s.defaultAgentId)
          ? s.defaultAgentId
          : (agents[0]?.id ?? ''),
      }))
    },

    async newChat(agentId) {
      const id = agentId ?? get().defaultAgentId
      const key = nextKey++
      const chat: Chat = {
        key,
        agentId: id,
        sessionId: null,
        state: 'starting',
        items: [],
        busy: false,
        modes: null,
      }
      set((s) => ({ chats: [...s.chats, chat], activeKey: key, defaultAgentId: id }))
      await startSession(key)
    },

    retryChat: startSession,

    closeChat(key) {
      const chat = get().chats.find((c) => c.key === key)
      if (chat?.busy && chat.sessionId) void window.lookingglass.agent.cancel(chat.sessionId)
      set((s) => {
        const chats = s.chats.filter((c) => c.key !== key)
        const index = s.chats.findIndex((c) => c.key === key)
        const activeKey =
          s.activeKey === key ? ((chats[index] ?? chats[index - 1])?.key ?? null) : s.activeKey
        return { chats, activeKey }
      })
    },

    activate(key) {
      set({ activeKey: key })
    },

    async send(key, text, attachments) {
      const chat = get().chats.find((c) => c.key === key)
      if (!chat?.sessionId || chat.busy || (!text.trim() && !attachments.length)) return
      const prompt: ContentBlock[] = [
        ...(text.trim() ? [{ type: 'text' as const, text }] : []),
        ...attachments,
      ]
      const names = attachments.flatMap((a) => (a.type === 'resource_link' ? [a.name] : []))
      patch(key, (c) => ({ busy: true, items: [...c.items, userItem(text, names)] }))
      const result = await window.lookingglass.agent.prompt(chat.sessionId, prompt)
      patch(key, (c) => ({
        busy: false,
        items: [...c.items, turnEnd(result.stopReason, result.error)],
      }))
    },

    async cancel(key) {
      const sessionId = get().chats.find((c) => c.key === key)?.sessionId
      if (sessionId) await window.lookingglass.agent.cancel(sessionId)
    },

    async setMode(key, modeId) {
      const chat = get().chats.find((c) => c.key === key)
      if (!chat?.sessionId || !chat.modes) return
      await window.lookingglass.agent.setMode(chat.sessionId, modeId)
      patch(key, (c) => ({ modes: c.modes ? { ...c.modes, currentModeId: modeId } : null }))
    },

    respondPermission(requestId, optionId) {
      void window.lookingglass.agent.respondPermission(requestId, optionId ? { optionId } : null)
      get().removePermission(requestId)
    },

    applyUpdate(sessionId, update) {
      set((s) => ({
        chats: s.chats.map((c) => {
          if (c.sessionId !== sessionId) return c
          if (update.sessionUpdate === 'current_mode_update') {
            return { ...c, modes: c.modes ? { ...c.modes, currentModeId: update.currentModeId } : null }
          }
          return { ...c, items: applyUpdate(c.items, update) }
        }),
      }))
    },

    setStatus(agentId, status) {
      set((s) => ({ statuses: { ...s.statuses, [agentId]: status } }))
      // An agent that died takes its sessions with it.
      if (status.state === 'error' || status.state === 'stopped') {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.agentId === agentId && c.state === 'ready'
              ? {
                  ...c,
                  state: 'error',
                  busy: false,
                  sessionId: null,
                  error: status.state === 'error' ? status.message : 'The agent stopped.',
                }
              : c,
          ),
        }))
      }
    },

    addPermission(request) {
      set((s) => ({ permissions: { ...s.permissions, [request.requestId]: request } }))
    },

    removePermission(requestId) {
      set((s) => {
        if (!s.permissions[requestId]) return s
        const permissions = { ...s.permissions }
        delete permissions[requestId]
        return { permissions }
      })
    },

    reset() {
      set({ chats: [], activeKey: null, permissions: {} })
    },
  }
})

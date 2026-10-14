import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk'
import { create } from 'zustand'
import type { PromptCapabilities } from '@agentclientprotocol/sdk'
import type {
  AgentStatus,
  AgentSummary,
  AuthRequired,
  ContentBlock,
  PermissionRequest,
  SessionUpdate,
} from '@lookingglass/shared/agent'
import { applyUpdate, notice, turnEnd, userItem, type TranscriptItem } from '../agent/transcript'
import { agentTabPath, tabId, useEditor } from './editor'
import { useUi } from './ui'

export type ChatState = 'starting' | 'auth' | 'ready' | 'error'

/**
 * Where a new chat shows up: the sidebar's one chat, a tab in front, or a tab
 * opened behind the current one (e.g. a Cmd+K edit, watched only if you want to).
 */
export type ChatPlacement = 'sidebar' | 'tab' | 'background'

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
  configOptions: SessionConfigOption[]
  promptCapabilities: PromptCapabilities
  /** The agent can `session/load` this chat's session. */
  canResume: boolean
  /** A session to load instead of starting a new one: picked from history, or lost when the agent stopped. */
  resumeId?: string
  title?: string
}

/** Something attached to a message: a chip label plus the content blocks it sends. */
export interface Attachment {
  label: string
  blocks: ContentBlock[]
  /**
   * Separately toggleable pieces (e.g. a picked element's markup, styles and
   * screenshot). When present they replace `blocks`: only ticked parts are sent.
   */
  parts?: AttachmentPart[]
}

export interface AttachmentPart {
  label: string
  blocks: ContentBlock[]
  on: boolean
  /** Always sent; shown for transparency but can't be unticked. */
  locked?: boolean
}

/** The content blocks an attachment sends. */
export function attachmentBlocks(attachment: Attachment): ContentBlock[] {
  return attachment.parts
    ? attachment.parts.filter((p) => p.on || p.locked).flatMap((p) => p.blocks)
    : attachment.blocks
}

interface AgentsStore {
  agents: AgentSummary[]
  statuses: Record<string, AgentStatus>
  chats: Chat[]
  /** The chat in the sidebar's Agents view; every other chat is a tab. Browser asks go here. */
  sidebarKey: number | null
  /** Open permission requests by requestId. */
  permissions: Record<string, PermissionRequest>
  defaultAgentId: string

  loadAgents(): Promise<void>
  /** Start a chat (in a tab unless placed elsewhere); resolves once its session is ready or failed. */
  newChat(agentId?: string, options?: { title?: string; placement?: ChatPlacement }): Promise<number>
  /** Open a past session from the agent's history (or switch to it if it's already open). */
  openSession(
    agentId: string,
    sessionId: string,
    title?: string | null,
    placement?: ChatPlacement,
  ): Promise<void>
  retryChat(key: number): Promise<void>
  closeChat(key: number): void
  /** Bring a chat to the front, wherever it lives. */
  reveal(key: number): void
  /** Put a chat in the sidebar; the chat already there moves to a tab. */
  moveToSidebar(key: number): void
  /** Move the sidebar's chat into a tab in front. */
  moveToTab(key: number): void
  send(key: number, text: string, attachments: Attachment[]): Promise<void>
  restore(key: number, itemId: number): Promise<void>
  /** Attachments waiting in a chat's composer (e.g. an element picked in the browser). */
  pending: Record<number, Attachment[]>
  addPending(attachment: Attachment): Promise<void>
  takePending(key: number): Attachment[]
  /** Send to the sidebar's chat, or a new one there; starts a chat with the default agent if needed. */
  ask(text: string, attachments: Attachment[], options?: { newChat?: boolean }): Promise<void>
  cancel(key: number): Promise<void>
  setMode(key: number, modeId: string): Promise<void>
  /** Switch an empty chat to another agent (a session is tied to its agent). Also the default for new chats. */
  setAgent(key: number, agentId: string): Promise<void>
  setConfigOption(key: number, configId: string, value: string): Promise<void>
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
    const resumeId = chat.resumeId
    // A loaded session replays its whole history, so start from an empty transcript. The
    // session id is set first so the replayed updates land in this chat.
    patch(key, {
      state: 'starting',
      error: undefined,
      auth: undefined,
      ...(resumeId ? { sessionId: resumeId, items: [] } : {}),
    })
    try {
      const result = resumeId
        ? await window.lookingglass.agent.loadSession(chat.agentId, resumeId)
        : await window.lookingglass.agent.newSession(chat.agentId)
      if ('authRequired' in result) {
        patch(key, { state: 'auth', auth: result, ...(resumeId ? { sessionId: null } : {}) })
      } else {
        patch(key, (c) => ({
          state: 'ready',
          sessionId: result.sessionId,
          resumeId: undefined,
          modes: result.modes ?? null,
          configOptions: result.configOptions ?? [],
          promptCapabilities: result.promptCapabilities,
          canResume: result.canResume,
          items: resumeId ? [...c.items, notice('Resumed an earlier session.')] : c.items,
        }))
      }
    } catch (error) {
      patch(key, {
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
        ...(resumeId ? { sessionId: null } : {}),
      })
    }
  }

  function place(key: number, placement: ChatPlacement): void {
    if (placement === 'sidebar') get().moveToSidebar(key)
    else useEditor.getState().openAgent(key, { activate: placement === 'tab' })
  }

  /** The sidebar's chat, started fresh when asked or when there's no usable one. */
  async function sidebarChat(fresh = false): Promise<Chat | undefined> {
    const current = get().chats.find((c) => c.key === get().sidebarKey)
    if (fresh || !current || current.state === 'error')
      await get().newChat(undefined, { placement: 'sidebar' })
    else useUi.getState().showSidebar('agents')
    return get().chats.find((c) => c.key === get().sidebarKey)
  }

  function addChat(agentId: string, placement: ChatPlacement, extra: Partial<Chat> = {}): number {
    const key = nextKey++
    const chat: Chat = {
      key,
      agentId,
      sessionId: null,
      state: 'starting',
      items: [],
      busy: false,
      modes: null,
      configOptions: [],
      promptCapabilities: {},
      canResume: false,
      ...extra,
    }
    set((s) => ({ chats: [...s.chats, chat], defaultAgentId: agentId }))
    place(key, placement)
    return key
  }

  return {
    agents: [],
    statuses: {},
    chats: [],
    sidebarKey: null,
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

    async newChat(agentId, options) {
      const key = addChat(
        agentId ?? get().defaultAgentId,
        options?.placement ?? 'tab',
        options?.title ? { title: options.title } : {},
      )
      await startSession(key)
      return key
    },

    async openSession(agentId, sessionId, title, placement = 'tab') {
      const open = get().chats.find((c) => c.sessionId === sessionId || c.resumeId === sessionId)
      if (open) return get().reveal(open.key)
      await startSession(addChat(agentId, placement, { resumeId: sessionId, ...(title ? { title } : {}) }))
    },

    retryChat: startSession,

    closeChat(key) {
      const chat = get().chats.find((c) => c.key === key)
      if (chat?.busy && chat.sessionId) void window.lookingglass.agent.cancel(chat.sessionId)
      set((s) => ({
        chats: s.chats.filter((c) => c.key !== key),
        sidebarKey: s.sidebarKey === key ? null : s.sidebarKey,
      }))
      useEditor.getState().removeTab(tabId('agent', agentTabPath(key)))
    },

    reveal(key) {
      if (get().sidebarKey === key) useUi.getState().showSidebar('agents')
      else useEditor.getState().openAgent(key)
    },

    moveToSidebar(key) {
      const previous = get().sidebarKey
      if (previous !== null && previous !== key) useEditor.getState().openAgent(previous, { activate: false })
      useEditor.getState().removeTab(tabId('agent', agentTabPath(key)))
      set({ sidebarKey: key })
      useUi.getState().showSidebar('agents')
    },

    moveToTab(key) {
      if (get().sidebarKey === key) set({ sidebarKey: null })
      useEditor.getState().openAgent(key)
    },

    async send(key, text, attachments) {
      const chat = get().chats.find((c) => c.key === key)
      if (!chat?.sessionId || chat.busy || (!text.trim() && !attachments.length)) return
      const prompt: ContentBlock[] = [
        ...(text.trim() ? [{ type: 'text' as const, text }] : []),
        ...attachments.flatMap(attachmentBlocks),
      ]
      const user = userItem(
        text,
        attachments.map((a) => a.label),
      )
      patch(key, (c) => ({ busy: true, items: [...c.items, user] }))
      const result = await window.lookingglass.agent.prompt(chat.sessionId, prompt)
      patch(key, (c) => ({
        busy: false,
        items: [
          ...c.items.map((i) => (i.id === user.id ? { ...i, checkpoint: result.checkpoint ?? null } : i)),
          turnEnd(result.stopReason, result.error),
        ],
      }))
    },

    pending: {},

    async addPending(attachment) {
      const key = (await sidebarChat())?.key
      if (key === undefined) return
      set((s) => ({ pending: { ...s.pending, [key]: [...(s.pending[key] ?? []), attachment] } }))
    },

    takePending(key) {
      const taken = get().pending[key] ?? []
      if (taken.length) set((s) => ({ pending: { ...s.pending, [key]: [] } }))
      return taken
    },

    async ask(text, attachments, options) {
      const chat = await sidebarChat(options?.newChat)
      if (!chat) return
      if (chat.state !== 'ready' || chat.busy) {
        // Can't send right now (logging in, or mid-turn): leave it in the composer.
        for (const a of attachments) await get().addPending(a)
        return
      }
      await get().send(chat.key, text, attachments)
    },

    async restore(key, itemId) {
      const chat = get().chats.find((c) => c.key === key)
      const item = chat?.items.find((i) => i.id === itemId)
      if (!chat || chat.busy || item?.kind !== 'user' || !item.checkpoint) return
      await window.lookingglass.review.restore(item.checkpoint)
      patch(key, (c) => ({ items: [...c.items, notice('Files restored to before this message.')] }))
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

    async setConfigOption(key, configId, value) {
      const chat = get().chats.find((c) => c.key === key)
      if (!chat?.sessionId) return
      try {
        const configOptions = await window.lookingglass.agent.setConfigOption(chat.sessionId, configId, value)
        patch(key, { configOptions })
      } catch (error) {
        patch(key, (c) => ({
          items: [
            ...c.items,
            notice(`Couldn't change setting: ${error instanceof Error ? error.message : String(error)}`),
          ],
        }))
      }
    },

    async setAgent(key, agentId) {
      const chat = get().chats.find((c) => c.key === key)
      if (!chat || chat.busy || chat.items.length || chat.agentId === agentId) return
      set({ defaultAgentId: agentId })
      patch(key, {
        agentId,
        sessionId: null,
        modes: null,
        configOptions: [],
        canResume: false,
        promptCapabilities: {},
      })
      await startSession(key)
    },

    respondPermission(requestId, optionId) {
      void window.lookingglass.agent.respondPermission(requestId, optionId ? { optionId } : null)
      get().removePermission(requestId)
    },

    applyUpdate(sessionId, update) {
      set((s) => ({
        chats: s.chats.map((c) => {
          if (c.sessionId !== sessionId) return c
          if (update.sessionUpdate === 'config_option_update') {
            return { ...c, configOptions: update.configOptions }
          }
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
                  // Retry picks the conversation back up when the agent can load it.
                  ...(c.canResume && c.sessionId ? { resumeId: c.sessionId } : {}),
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
      set({ chats: [], sidebarKey: null, permissions: {} })
    },
  }
})

/**
 * Agent-facing IPC types. ACP protocol types come straight from the SDK
 * (type-only imports, so nothing from the SDK is bundled into the renderer).
 */
import type {
  AuthMethod,
  ContentBlock,
  PermissionOption,
  PromptCapabilities,
  SessionModeState,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'

export type { ContentBlock, PermissionOption, SessionUpdate, StopReason }

export interface AgentSummary {
  id: string
  label: string
  /** Built-in agents ship with the app; custom ones come from ~/.lookingglass/agents.json. */
  builtIn: boolean
}

export type AgentStatus =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'ready'; agentName?: string; agentVersion?: string }
  | { state: 'error'; message: string }

export interface NewSessionResult {
  sessionId: string
  agentId: string
  modes?: SessionModeState | null
  /** What the agent accepts in prompts beyond text (images, embedded file contents). */
  promptCapabilities: PromptCapabilities
}

/** Returned instead of a session when the agent wants the user to log in first. */
export interface AuthRequired {
  authRequired: true
  agentId: string
  methods: AuthMethod[]
  message: string
}

export interface PromptResult {
  stopReason: StopReason | 'error'
  error?: string
  /** Snapshot taken before the turn; restoring it undoes the turn's file changes. */
  checkpoint?: string | null
}

export interface PermissionRequest {
  requestId: string
  sessionId: string
  toolCall: ToolCallUpdate
  options: PermissionOption[]
}

/** Reply to a permission request. `null` = dismissed (treated as cancelled). */
export type PermissionReply = { optionId: string } | null

/** What the renderer tells main about the editor, for agent reads and editor-aware MCP tools. */
export interface EditorSnapshot {
  openFiles: string[]
  activeFile: string | null
  /** Unsaved editor contents by path. Clean files are omitted. */
  dirty: Record<string, string>
}

/**
 * Agent-facing IPC types. ACP protocol types come straight from the SDK
 * (type-only imports, so nothing from the SDK is bundled into the renderer).
 */
import type {
  AuthMethod,
  ContentBlock,
  PermissionOption,
  PromptCapabilities,
  SessionConfigOption,
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
  /** Session settings the agent exposes, such as the model (`category: "model"`). */
  configOptions?: SessionConfigOption[] | null
  /** What the agent accepts in prompts beyond text (images, embedded file contents). */
  promptCapabilities: PromptCapabilities
  /** The agent supports `session/load`, so this session can be resumed later. */
  canResume: boolean
}

/** A past session the agent reports through `session/list`. */
export interface SessionSummary {
  sessionId: string
  agentId: string
  title: string | null
  /** ISO 8601, when the agent reports it. */
  updatedAt: string | null
}

export interface SessionHistory {
  /** False when the agent can't list or load sessions. */
  supported: boolean
  sessions: SessionSummary[]
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

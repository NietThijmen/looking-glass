import type {
  CreateTerminalRequest,
  TerminalExitStatus,
  TerminalOutputResponse,
} from '@agentclientprotocol/sdk'
import type { FileReadResult, FileWriteResult } from '@lookingglass/shared/ipc'

/** Workspace file access the agent manager actually calls. */
export interface FileHost {
  readonly root: string | null
  readFile(relPath: string): Promise<FileReadResult>
  readText(relPath: string): Promise<string | null>
  writeFile(relPath: string, contents: string): Promise<FileWriteResult>
}

/** Unsaved editor contents for a workspace-relative path. */
export interface EditorBuffers {
  unsaved(path: string): string | undefined
}

/** Review bookkeeping for one agent turn. */
export interface ReviewHost {
  beginTurn(sessionId: string): Promise<string | null>
  endTurn(sessionId: string): Promise<void>
  recordAgentWrite(path: string, before: string | null): Promise<void>
}

/** Agent terminals. The real pty service stays in the app. */
export interface TerminalHost {
  create(params: CreateTerminalRequest, cwd: string, agentLabel: string): string | Promise<string>
  output(terminalId: string): TerminalOutputResponse
  waitForExit(terminalId: string): Promise<TerminalExitStatus>
  kill(terminalId: string): void
  release(terminalId: string): void
  releaseAll(): void
}

/** Built-in MCP server handle attached to a session. */
export interface McpHost {
  url: string
  headers: Array<{ name: string; value: string }>
}

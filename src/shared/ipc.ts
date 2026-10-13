/**
 * The IPC contract between main, preload and renderer.
 *
 * Every channel is declared here once. Main registers handlers against
 * `InvokeContract`, preload exposes a domain-shaped API (`LookingglassApi`)
 * built only from these channels, and the renderer only ever sees that API.
 *
 * All file paths crossing IPC are workspace-relative and POSIX-style ("src/app.ts").
 */
import type {
  AgentStatus,
  AgentSummary,
  AuthRequired,
  ContentBlock,
  EditorSnapshot,
  NewSessionResult,
  PermissionReply,
  PermissionRequest,
  PromptResult,
  SessionUpdate,
} from './agent'

export interface AppInfo {
  name: string
  version: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
  platform: NodeJS.Platform
}

export interface WindowState {
  focused: boolean
  fullscreen: boolean
}

export interface WorkspaceInfo {
  /** Absolute, real path of the workspace root. Display only; never sent back to main. */
  root: string
  name: string
}

export type DirEntryKind = 'file' | 'dir'

export interface DirEntry {
  name: string
  path: string
  kind: DirEntryKind
}

export interface FileReadResult {
  path: string
  contents: string
  /** True when the file looks binary; `contents` is empty. */
  binary: boolean
  /** True when the file is over the size limit; `contents` is empty. */
  tooLarge: boolean
  size: number
  mtimeMs: number
}

export interface FileWriteResult {
  mtimeMs: number
}

export type FsChangeType = 'create' | 'update' | 'delete'

export interface FsChange {
  path: string
  type: FsChangeType
}

export interface SearchQuery {
  pattern: string
  regex?: boolean
  /** Undefined = smart case. */
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma-separated globs, like "src/**, *.ts". */
  include?: string
  exclude?: string
}

export interface SearchMatch {
  line: number
  text: string
  /** UTF-16 [start, end) column ranges in `text`. */
  ranges: Array<[number, number]>
}

export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
}

export interface SearchResult {
  files: SearchFileResult[]
  matchCount: number
  truncated: boolean
  /** Set when the pattern was invalid or rg failed. */
  error?: string
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitStatusEntry {
  path: string
  status: GitFileStatus
  /** The change (or part of it) is staged. */
  staged: boolean
  /** For renames: the old path. */
  from?: string
}

export interface GitStatus {
  branch: string | null
  entries: GitStatusEntry[]
}

export interface TerminalCreateOptions {
  cols: number
  rows: number
}

export interface TerminalInfo {
  id: string
  title: string
}

export type MenuCommand =
  'open-folder' | 'save' | 'close-tab' | 'toggle-terminal' | 'show-explorer' | 'show-search' | 'show-git'

/** Renderer → main request/response channels. */
export interface InvokeContract {
  'app:getInfo': { args: []; result: AppInfo }
  'window:getState': { args: []; result: WindowState }
  'clipboard:readText': { args: []; result: string }

  'workspace:get': { args: []; result: WorkspaceInfo | null }
  'workspace:openDialog': { args: []; result: WorkspaceInfo | null }

  'fs:readDir': { args: [path: string]; result: DirEntry[] }
  'fs:readFile': { args: [path: string]; result: FileReadResult }
  'fs:writeFile': { args: [path: string, contents: string]; result: FileWriteResult }

  'search:run': { args: [query: SearchQuery]; result: SearchResult }

  'git:status': { args: []; result: GitStatus | null }
  'git:headContents': { args: [path: string]; result: string | null }

  'terminal:create': { args: [options: TerminalCreateOptions]; result: TerminalInfo }
  'terminal:write': { args: [id: string, data: string]; result: void }
  'terminal:resize': { args: [id: string, cols: number, rows: number]; result: void }
  'terminal:kill': { args: [id: string]; result: void }

  'editor:snapshot': { args: [snapshot: EditorSnapshot]; result: void }

  'agent:list': { args: []; result: AgentSummary[] }
  'agent:status': { args: [agentId: string]; result: AgentStatus }
  'agent:newSession': { args: [agentId: string]; result: NewSessionResult | AuthRequired }
  'agent:authenticate': { args: [agentId: string, methodId: string]; result: void }
  'agent:prompt': { args: [sessionId: string, prompt: ContentBlock[]]; result: PromptResult }
  'agent:cancel': { args: [sessionId: string]; result: void }
  'agent:setMode': { args: [sessionId: string, modeId: string]; result: void }
  'agent:respondPermission': { args: [requestId: string, reply: PermissionReply]; result: void }
  'agent:startTerminalAuth': { args: [agentId: string, methodId: string]; result: TerminalInfo }

  'app:openExternal': { args: [url: string]; result: void }
}

/** Main → renderer push channels. */
export interface EventContract {
  'window:state': WindowState
  'menu:command': MenuCommand
  'workspace:changed': WorkspaceInfo | null
  'fs:changed': FsChange[]
  'git:changed': null
  'terminal:data': { id: string; data: string }
  'terminal:exit': { id: string; exitCode: number }
  /** A terminal main started on its own (e.g. an agent login), for the panel to show. */
  'terminal:opened': TerminalInfo
  'editor:openFile': { path: string; line?: number }
  'agent:status': { agentId: string; status: AgentStatus }
  'agent:update': { sessionId: string; update: SessionUpdate }
  'agent:permission': PermissionRequest
  'agent:permissionResolved': { requestId: string }
}

export type InvokeChannel = keyof InvokeContract
export type EventChannel = keyof EventContract
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result']

export type Unsubscribe = () => void
type Listener<C extends EventChannel> = (payload: EventContract[C]) => void

/** The API exposed on `window.lookingglass`. */
export interface LookingglassApi {
  app: {
    getInfo(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    onMenuCommand(listener: Listener<'menu:command'>): Unsubscribe
  }
  window: {
    getState(): Promise<WindowState>
    onState(listener: Listener<'window:state'>): Unsubscribe
  }
  clipboard: {
    readText(): Promise<string>
  }
  workspace: {
    get(): Promise<WorkspaceInfo | null>
    openDialog(): Promise<WorkspaceInfo | null>
    onChanged(listener: Listener<'workspace:changed'>): Unsubscribe
  }
  fs: {
    readDir(path: string): Promise<DirEntry[]>
    readFile(path: string): Promise<FileReadResult>
    writeFile(path: string, contents: string): Promise<FileWriteResult>
    onChanged(listener: Listener<'fs:changed'>): Unsubscribe
  }
  search: {
    run(query: SearchQuery): Promise<SearchResult>
  }
  git: {
    status(): Promise<GitStatus | null>
    headContents(path: string): Promise<string | null>
    onChanged(listener: Listener<'git:changed'>): Unsubscribe
  }
  editor: {
    publishSnapshot(snapshot: EditorSnapshot): Promise<void>
    onOpenFile(listener: Listener<'editor:openFile'>): Unsubscribe
  }
  agent: {
    list(): Promise<AgentSummary[]>
    status(agentId: string): Promise<AgentStatus>
    newSession(agentId: string): Promise<NewSessionResult | AuthRequired>
    authenticate(agentId: string, methodId: string): Promise<void>
    prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult>
    cancel(sessionId: string): Promise<void>
    setMode(sessionId: string, modeId: string): Promise<void>
    respondPermission(requestId: string, reply: PermissionReply): Promise<void>
    startTerminalAuth(agentId: string, methodId: string): Promise<TerminalInfo>
    onStatus(listener: Listener<'agent:status'>): Unsubscribe
    onUpdate(listener: Listener<'agent:update'>): Unsubscribe
    onPermission(listener: Listener<'agent:permission'>): Unsubscribe
    onPermissionResolved(listener: Listener<'agent:permissionResolved'>): Unsubscribe
  }
  terminal: {
    create(options: TerminalCreateOptions): Promise<TerminalInfo>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
    onData(listener: Listener<'terminal:data'>): Unsubscribe
    onExit(listener: Listener<'terminal:exit'>): Unsubscribe
    onOpened(listener: Listener<'terminal:opened'>): Unsubscribe
  }
}

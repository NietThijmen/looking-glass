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
  SessionHistory,
  SessionUpdate,
} from './agent'
import type { Diagnostic, DiagnosticsByPath } from './diagnostics'
import type { CustomAgentConfig, UserSettings } from './settings'
import type {
  BrowserBounds,
  BrowserTabState,
  ConsoleEntry,
  Picked,
  PickedElement,
  PickedRegion,
  PickMode,
} from './browser'
import type { PullRequestDetail } from './forge'
import type { ReviewEntry } from './review'

export type { PullRequestCheck, PullRequestDetail, PullRequestFile, PullRequestFileStatus } from './forge'

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

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** ISO-8601 timestamp from git. */
  date: string
}

export interface GitCommitResult {
  ok: boolean
  shortHash?: string
  error?: string
}

export interface GitPushResult {
  ok: boolean
  error?: string
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
  | 'open-folder'
  | 'save'
  | 'close-tab'
  | 'toggle-terminal'
  | 'toggle-sidebar'
  | 'show-explorer'
  | 'show-search'
  | 'show-git'
  | 'show-commits'
  | 'show-agents'
  | 'toggle-picker'
  | 'new-browser-tab'
  | 'inline-edit'
  | 'open-settings'

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
  'git:log': { args: [limit?: number]; result: GitLogEntry[] }
  'git:commit': { args: [message: string]; result: GitCommitResult }
  'git:push': { args: []; result: GitPushResult }
  /** Open pull request for the current branch, or null when there isn't one. */
  'git:pullRequest': { args: []; result: PullRequestDetail | null }

  'terminal:create': { args: [options: TerminalCreateOptions]; result: TerminalInfo }
  'terminal:write': { args: [id: string, data: string]; result: void }
  'terminal:resize': { args: [id: string, cols: number, rows: number]; result: void }
  'terminal:kill': { args: [id: string]; result: void }

  'editor:snapshot': { args: [snapshot: EditorSnapshot]; result: void }

  'settings:get': { args: []; result: UserSettings }
  'settings:set': { args: [patch: Partial<UserSettings>]; result: UserSettings }
  /** Custom agents from ~/.lookingglass/agents.json, with a parse error if the file is broken. */
  'agents:readConfig': {
    args: []
    result: { path: string; agents: CustomAgentConfig[]; error: string | null }
  }
  'agents:writeConfig': { args: [agents: CustomAgentConfig[]]; result: void }
  'agent:list': { args: []; result: AgentSummary[] }
  'agent:status': { args: [agentId: string]; result: AgentStatus }
  'agent:newSession': { args: [agentId: string]; result: NewSessionResult | AuthRequired }
  /** Past sessions in this workspace, newest first (`session/list`). */
  'agent:listSessions': { args: [agentId: string]; result: SessionHistory }
  /** Resume a past session (`session/load`); its history arrives as `agent:update` events first. */
  'agent:loadSession': { args: [agentId: string, sessionId: string]; result: NewSessionResult | AuthRequired }
  'agent:authenticate': { args: [agentId: string, methodId: string]; result: void }
  'agent:prompt': { args: [sessionId: string, prompt: ContentBlock[]]; result: PromptResult }
  'agent:cancel': { args: [sessionId: string]; result: void }
  'agent:setMode': { args: [sessionId: string, modeId: string]; result: void }
  'agent:respondPermission': { args: [requestId: string, reply: PermissionReply]; result: void }
  'agent:startTerminalAuth': { args: [agentId: string, methodId: string]; result: TerminalInfo }

  'app:openExternal': { args: [url: string]; result: void }

  /** Current diagnostics for files open in the language server, plus why there are none if it failed. */
  'diagnostics:all': { args: []; result: { diagnostics: DiagnosticsByPath; error: string | null } }
  'review:list': { args: []; result: ReviewEntry[] }
  /** Baseline contents of a file under review; null when the file didn't exist (or isn't under review). */
  'review:base': { args: [path: string]; result: string | null }
  /** `null` path = every file. */
  'review:accept': { args: [path: string | null]; result: void }
  'review:reject': { args: [path: string | null]; result: void }
  'review:setBase': { args: [path: string, content: string]; result: void }
  'review:writeCurrent': { args: [path: string, content: string]; result: void }
  'review:restore': { args: [checkpoint: string]; result: void }

  'fs:listFiles': { args: []; result: string[] }
  'git:diff': { args: []; result: string }

  'browser:create': { args: [url: string]; result: BrowserTabState }
  'browser:close': { args: [tabId: string]; result: void }
  'browser:state': { args: [tabId: string]; result: BrowserTabState }
  'browser:setBounds': { args: [tabId: string, bounds: BrowserBounds | null]; result: void }
  'browser:navigate': { args: [tabId: string, url: string]; result: void }
  'browser:back': { args: [tabId: string]; result: void }
  'browser:forward': { args: [tabId: string]; result: void }
  'browser:reload': { args: [tabId: string]; result: void }
  'browser:openDevTools': { args: [tabId: string]; result: void }
  'browser:setPicking': { args: [tabId: string, picking: boolean]; result: void }
  /** Replace the last picked element with its parent or first child. */
  'browser:walk': { args: [tabId: string, direction: 'parent' | 'child']; result: PickedElement | null }
  'browser:captureRegion': { args: [tabId: string]; result: PickedRegion | null }
  /** Drop one picked item by index, or all of them. */
  'browser:unpick': { args: [tabId: string, index?: number]; result: void }
  'browser:screenshot': { args: [tabId: string]; result: string }
  /** `previewUrl` from the workspace's `.lookingglass/settings.json`. */
  'browser:previewUrl': { args: []; result: string | null }
  'browser:console': { args: [tabId: string]; result: ConsoleEntry[] }
  'browser:clearConsole': { args: [tabId: string]; result: void }
  'browser:setAgentBlocked': { args: [tabId: string, blocked: boolean]; result: void }
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
  'review:changed': ReviewEntry[]
  'diagnostics:changed': { path: string; diagnostics: Diagnostic[] }
  'settings:changed': UserSettings
  /** agents.json was rewritten; the agent list may have changed. */
  'agents:changed': null
  'browser:state': BrowserTabState
  'browser:console': { tabId: string; entry: ConsoleEntry }
  'browser:picked': { item: Picked; mode: PickMode }
  /** An agent opened a tab; the renderer should show it. */
  'browser:opened': BrowserTabState
  /** An agent rewrote a file through ACP; open buffers should reload it. */
  'editor:reloadFile': { path: string }
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
    /** Workspace files (gitignore respected), for @-mentions. */
    listFiles(): Promise<string[]>
    onChanged(listener: Listener<'fs:changed'>): Unsubscribe
  }
  search: {
    run(query: SearchQuery): Promise<SearchResult>
  }
  git: {
    status(): Promise<GitStatus | null>
    headContents(path: string): Promise<string | null>
    /** `git diff HEAD` for the workspace. */
    diff(): Promise<string>
    log(limit?: number): Promise<GitLogEntry[]>
    commit(message: string): Promise<GitCommitResult>
    push(): Promise<GitPushResult>
    /** Open pull request for the current branch, or null. A missing `gh` login is null. */
    pullRequest(): Promise<PullRequestDetail | null>
    onChanged(listener: Listener<'git:changed'>): Unsubscribe
  }
  editor: {
    publishSnapshot(snapshot: EditorSnapshot): Promise<void>
    onOpenFile(listener: Listener<'editor:openFile'>): Unsubscribe
    onReloadFile(listener: Listener<'editor:reloadFile'>): Unsubscribe
  }
  browser: {
    create(url: string): Promise<BrowserTabState>
    close(tabId: string): Promise<void>
    state(tabId: string): Promise<BrowserTabState>
    setBounds(tabId: string, bounds: BrowserBounds | null): Promise<void>
    navigate(tabId: string, url: string): Promise<void>
    back(tabId: string): Promise<void>
    forward(tabId: string): Promise<void>
    reload(tabId: string): Promise<void>
    openDevTools(tabId: string): Promise<void>
    setPicking(tabId: string, picking: boolean): Promise<void>
    walk(tabId: string, direction: 'parent' | 'child'): Promise<PickedElement | null>
    captureRegion(tabId: string): Promise<PickedRegion | null>
    unpick(tabId: string, index?: number): Promise<void>
    screenshot(tabId: string): Promise<string>
    previewUrl(): Promise<string | null>
    console(tabId: string): Promise<ConsoleEntry[]>
    clearConsole(tabId: string): Promise<void>
    setAgentBlocked(tabId: string, blocked: boolean): Promise<void>
    onState(listener: Listener<'browser:state'>): Unsubscribe
    onConsole(listener: Listener<'browser:console'>): Unsubscribe
    onPicked(listener: Listener<'browser:picked'>): Unsubscribe
    onOpened(listener: Listener<'browser:opened'>): Unsubscribe
  }
  settings: {
    get(): Promise<UserSettings>
    set(patch: Partial<UserSettings>): Promise<UserSettings>
    readAgents(): Promise<{ path: string; agents: CustomAgentConfig[]; error: string | null }>
    writeAgents(agents: CustomAgentConfig[]): Promise<void>
    onChanged(listener: Listener<'settings:changed'>): Unsubscribe
    onAgentsChanged(listener: Listener<'agents:changed'>): Unsubscribe
  }
  diagnostics: {
    all(): Promise<{ diagnostics: DiagnosticsByPath; error: string | null }>
    onChanged(listener: Listener<'diagnostics:changed'>): Unsubscribe
  }
  review: {
    list(): Promise<ReviewEntry[]>
    base(path: string): Promise<string | null>
    accept(path: string | null): Promise<void>
    reject(path: string | null): Promise<void>
    setBase(path: string, content: string): Promise<void>
    writeCurrent(path: string, content: string): Promise<void>
    restore(checkpoint: string): Promise<void>
    onChanged(listener: Listener<'review:changed'>): Unsubscribe
  }
  agent: {
    list(): Promise<AgentSummary[]>
    status(agentId: string): Promise<AgentStatus>
    newSession(agentId: string): Promise<NewSessionResult | AuthRequired>
    listSessions(agentId: string): Promise<SessionHistory>
    loadSession(agentId: string, sessionId: string): Promise<NewSessionResult | AuthRequired>
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

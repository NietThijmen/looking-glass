import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  EventChannel,
  EventContract,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  LookingglassApi,
  Unsubscribe,
} from '../shared/ipc'

// Sandboxed preload: only `electron` may be imported at runtime. Everything
// else from ../shared must be type-only.

function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>
}

function subscribe<C extends EventChannel>(
  channel: C,
  listener: (payload: EventContract[C]) => void,
): Unsubscribe {
  // Never hand the raw IpcRendererEvent (which exposes `sender`) to the page.
  const wrapped = (_event: IpcRendererEvent, payload: EventContract[C]): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: LookingglassApi = {
  app: {
    getInfo: () => invoke('app:getInfo'),
    openExternal: (url) => invoke('app:openExternal', url),
    onMenuCommand: (listener) => subscribe('menu:command', listener),
  },
  window: {
    getState: () => invoke('window:getState'),
    onState: (listener) => subscribe('window:state', listener),
  },
  clipboard: {
    readText: () => invoke('clipboard:readText'),
  },
  workspace: {
    get: () => invoke('workspace:get'),
    openDialog: () => invoke('workspace:openDialog'),
    onChanged: (listener) => subscribe('workspace:changed', listener),
  },
  fs: {
    readDir: (path) => invoke('fs:readDir', path),
    readFile: (path) => invoke('fs:readFile', path),
    writeFile: (path, contents) => invoke('fs:writeFile', path, contents),
    listFiles: () => invoke('fs:listFiles'),
    onChanged: (listener) => subscribe('fs:changed', listener),
  },
  search: {
    run: (query) => invoke('search:run', query),
  },
  git: {
    status: () => invoke('git:status'),
    headContents: (path) => invoke('git:headContents', path),
    diff: () => invoke('git:diff'),
    log: (limit) => invoke('git:log', limit),
    commit: (message) => invoke('git:commit', message),
    push: () => invoke('git:push'),
    onChanged: (listener) => subscribe('git:changed', listener),
  },
  editor: {
    publishSnapshot: (snapshot) => invoke('editor:snapshot', snapshot),
    onOpenFile: (listener) => subscribe('editor:openFile', listener),
    onReloadFile: (listener) => subscribe('editor:reloadFile', listener),
  },
  browser: {
    create: (url) => invoke('browser:create', url),
    close: (tabId) => invoke('browser:close', tabId),
    state: (tabId) => invoke('browser:state', tabId),
    setBounds: (tabId, bounds) => invoke('browser:setBounds', tabId, bounds),
    navigate: (tabId, url) => invoke('browser:navigate', tabId, url),
    back: (tabId) => invoke('browser:back', tabId),
    forward: (tabId) => invoke('browser:forward', tabId),
    reload: (tabId) => invoke('browser:reload', tabId),
    openDevTools: (tabId) => invoke('browser:openDevTools', tabId),
    setPicking: (tabId, picking) => invoke('browser:setPicking', tabId, picking),
    walk: (tabId, direction) => invoke('browser:walk', tabId, direction),
    captureRegion: (tabId) => invoke('browser:captureRegion', tabId),
    unpick: (tabId, index) => invoke('browser:unpick', tabId, index),
    screenshot: (tabId) => invoke('browser:screenshot', tabId),
    previewUrl: () => invoke('browser:previewUrl'),
    console: (tabId) => invoke('browser:console', tabId),
    clearConsole: (tabId) => invoke('browser:clearConsole', tabId),
    setAgentBlocked: (tabId, blocked) => invoke('browser:setAgentBlocked', tabId, blocked),
    onState: (listener) => subscribe('browser:state', listener),
    onConsole: (listener) => subscribe('browser:console', listener),
    onPicked: (listener) => subscribe('browser:picked', listener),
    onOpened: (listener) => subscribe('browser:opened', listener),
  },
  review: {
    list: () => invoke('review:list'),
    base: (path) => invoke('review:base', path),
    accept: (path) => invoke('review:accept', path),
    reject: (path) => invoke('review:reject', path),
    setBase: (path, content) => invoke('review:setBase', path, content),
    writeCurrent: (path, content) => invoke('review:writeCurrent', path, content),
    restore: (checkpoint) => invoke('review:restore', checkpoint),
    onChanged: (listener) => subscribe('review:changed', listener),
  },
  agent: {
    list: () => invoke('agent:list'),
    status: (agentId) => invoke('agent:status', agentId),
    newSession: (agentId) => invoke('agent:newSession', agentId),
    authenticate: (agentId, methodId) => invoke('agent:authenticate', agentId, methodId),
    prompt: (sessionId, prompt) => invoke('agent:prompt', sessionId, prompt),
    cancel: (sessionId) => invoke('agent:cancel', sessionId),
    setMode: (sessionId, modeId) => invoke('agent:setMode', sessionId, modeId),
    respondPermission: (requestId, reply) => invoke('agent:respondPermission', requestId, reply),
    startTerminalAuth: (agentId, methodId) => invoke('agent:startTerminalAuth', agentId, methodId),
    onStatus: (listener) => subscribe('agent:status', listener),
    onUpdate: (listener) => subscribe('agent:update', listener),
    onPermission: (listener) => subscribe('agent:permission', listener),
    onPermissionResolved: (listener) => subscribe('agent:permissionResolved', listener),
  },
  terminal: {
    create: (options) => invoke('terminal:create', options),
    write: (id, data) => invoke('terminal:write', id, data),
    resize: (id, cols, rows) => invoke('terminal:resize', id, cols, rows),
    kill: (id) => invoke('terminal:kill', id),
    onData: (listener) => subscribe('terminal:data', listener),
    onExit: (listener) => subscribe('terminal:exit', listener),
    onOpened: (listener) => subscribe('terminal:opened', listener),
  },
}

contextBridge.exposeInMainWorld('lookingglass', api)

import type { McpServer } from '@agentclientprotocol/sdk'
import { app, BrowserWindow, dialog } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { AgentManager } from '../acp/AgentManager'
import { loadAgentDefinitions } from '../acp/registry'
import { EditorState } from '../editor/EditorState'
import { DiagnosticsService } from '../lsp/DiagnosticsService'
import { startEditorMcpServer, type EditorMcpHandle } from '../mcp/editorMcpServer'
import { isSmokeTest } from '../env'
import { PermissionService } from '../permissions/PermissionService'
import { Checkpoints } from '../review/Checkpoints'
import { ReviewService } from '../review/ReviewService'
import { loadAppState, saveAppState } from '../state/appState'
import { AgentTerminals } from '../terminal/AgentTerminals'
import { describeMcpServers, mcpServersHash, readWorkspaceMcpServers } from '../workspace/mcpConfig'
import { broadcast } from './broadcast'
import { browserToolDeps } from './browser'
import { handle } from './typed'
import { git, onWorkspaceFsChange, onWorkspaceWillChange, terminals, workspace } from './workspace'

const editor = new EditorState()
export const diagnostics = new DiagnosticsService({
  workspace,
  onChange: (path, list) => broadcast('diagnostics:changed', { path, diagnostics: list }),
})
const permissions = new PermissionService(
  (request) => broadcast('agent:permission', request),
  (requestId) => broadcast('agent:permissionResolved', { requestId }),
)
let mcp: EditorMcpHandle | null = null
/** The built-in MCP server's address (for smoke tests that call its tools directly). */
export const editorMcp = (): EditorMcpHandle | null => mcp

// Shadow repos for checkpoints; smoke runs use throwaway fixtures, so keep theirs out of userData.
const checkpointDir = (): string =>
  isSmokeTest
    ? path.join(os.tmpdir(), 'lookingglass-smoke-checkpoints')
    : path.join(app.getPath('userData'), 'checkpoints')
let checkpoints: Checkpoints | null = null
const currentCheckpoints = (): Checkpoints | null => {
  const root = workspace.root
  if (!root) return null
  if (checkpoints?.root !== root) checkpoints = new Checkpoints(root, checkpointDir())
  return checkpoints
}

export const review = new ReviewService(workspace, currentCheckpoints, (entries) =>
  broadcast('review:changed', entries),
)
const agentTerminals = new AgentTerminals(terminals, (info) => broadcast('terminal:opened', info))

/** One prompt at a time per server list, however many sessions start together. */
const mcpApprovals = new Map<string, Promise<boolean>>()

/**
 * `.lookingglass/settings.json` MCP servers, if the user allowed this exact list for
 * this folder. A cloned repo could otherwise make an agent start any command.
 */
async function workspaceMcpServers(): Promise<McpServer[]> {
  const root = workspace.root
  if (!root) return []
  const servers = await readWorkspaceMcpServers(root)
  if (!servers.length) return []
  const hash = mcpServersHash(servers)
  if ((await loadAppState()).trustedMcpServers?.[root] === hash) return servers
  const key = `${root}\0${hash}`
  let approval = mcpApprovals.get(key)
  if (!approval) {
    approval = askToAllowMcpServers(root, servers).finally(() => mcpApprovals.delete(key))
    mcpApprovals.set(key, approval)
  }
  if (!(await approval)) return []
  const state = await loadAppState()
  await saveAppState({ trustedMcpServers: { ...state.trustedMcpServers, [root]: hash } })
  return servers
}

async function askToAllowMcpServers(root: string, servers: McpServer[]): Promise<boolean> {
  if (isSmokeTest) return false
  const options = {
    type: 'question' as const,
    buttons: ['Allow', 'Not now'],
    defaultId: 1,
    cancelId: 1,
    message: 'This folder wants to give agents extra MCP servers',
    detail: `${root}/.lookingglass/settings.json lists:\n\n${describeMcpServers(servers)}\n\nAgents start these themselves, so only allow them if you trust this project. You'll be asked again if the list changes.`,
  }
  const win = BrowserWindow.getAllWindows()[0]
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 0
}

export const agents = new AgentManager({
  definitions: loadAgentDefinitions,
  workspace,
  editor,
  permissions,
  mcp: () => mcp,
  workspaceMcpServers,
  onStatus: (agentId, status) => broadcast('agent:status', { agentId, status }),
  onSessionUpdate: ({ sessionId, update }) => broadcast('agent:update', { sessionId, update }),
  review,
  terminals: agentTerminals,
  onAgentWrite: (path) => broadcast('editor:reloadFile', { path }),
})

export async function startAgentServices(): Promise<void> {
  try {
    mcp = await startEditorMcpServer({
      workspace: () => workspace.info,
      editor,
      gitStatus: async () => (workspace.root ? git.status(workspace.root) : null),
      browser: browserToolDeps,
      diagnostics: (path) => diagnostics.diagnostics(path),
      openFile: async (path, line) => {
        await workspace.resolve(path)
        broadcast('editor:openFile', { path, ...(line ? { line } : {}) })
      },
    })
  } catch (error) {
    // Agents still work without editor tools.
    console.error('[mcp] failed to start editor MCP server', error)
  }
  onWorkspaceWillChange(() => {
    agents.disposeAll()
    editor.reset()
    review.reset()
    void diagnostics.dispose()
  })
  onWorkspaceFsChange((changes) => {
    review.notifyFsChange()
    void diagnostics.filesChanged(changes.map((c) => c.path))
  })
}

export async function stopAgentServices(): Promise<void> {
  agents.disposeAll()
  await diagnostics.dispose()
  await mcp?.close()
  mcp = null
}

export function registerAgentHandlers(): void {
  handle('editor:snapshot', (_e, snapshot) => {
    editor.update(snapshot)
    void diagnostics.syncEditor(snapshot)
  })
  handle('diagnostics:all', () => ({ diagnostics: diagnostics.all(), error: diagnostics.error }))

  handle('agent:list', () => agents.list())
  handle('agent:status', (_e, agentId) => agents.status(agentId))
  handle('agent:newSession', (_e, agentId) => agents.newSession(agentId))
  handle('agent:listSessions', (_e, agentId) => agents.listSessions(agentId))
  handle('agent:loadSession', (_e, agentId, sessionId) => agents.loadSession(agentId, sessionId))
  handle('agent:authenticate', (_e, agentId, methodId) => agents.authenticate(agentId, methodId))
  handle('agent:prompt', (_e, sessionId, prompt) => agents.prompt(sessionId, prompt))
  handle('agent:cancel', (_e, sessionId) => agents.cancel(sessionId))
  handle('agent:setMode', (_e, sessionId, modeId) => agents.setMode(sessionId, modeId))
  handle('agent:respondPermission', (_e, requestId, reply) => permissions.respond(requestId, reply))
  handle('review:list', () => review.entries())
  handle('review:base', (_e, path) => review.base(path) ?? null)
  handle('review:accept', (_e, path) => review.accept(path))
  handle('review:reject', (_e, path) => review.reject(path))
  handle('review:setBase', (_e, path, content) => review.setBase(path, content))
  handle('review:writeCurrent', (_e, path, content) => review.writeCurrent(path, content))
  handle('review:restore', (_e, checkpoint) => review.restore(checkpoint))

  handle('agent:startTerminalAuth', async (_e, agentId, methodId) => {
    const command = await agents.terminalAuthCommand(agentId, methodId)
    const info = terminals.create(workspace.root, { cols: 100, rows: 30 }, command)
    broadcast('terminal:opened', info)
    return info
  })
}

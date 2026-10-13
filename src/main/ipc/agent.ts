import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { AgentManager } from '../acp/AgentManager'
import { loadAgentDefinitions } from '../acp/registry'
import { EditorState } from '../editor/EditorState'
import { startEditorMcpServer, type EditorMcpHandle } from '../mcp/editorMcpServer'
import { isSmokeTest } from '../env'
import { PermissionService } from '../permissions/PermissionService'
import { Checkpoints } from '../review/Checkpoints'
import { ReviewService } from '../review/ReviewService'
import { AgentTerminals } from '../terminal/AgentTerminals'
import { broadcast } from './broadcast'
import { browserToolDeps } from './browser'
import { handle } from './typed'
import { git, onWorkspaceFsChange, onWorkspaceWillChange, terminals, workspace } from './workspace'

const editor = new EditorState()
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

export const agents = new AgentManager({
  definitions: loadAgentDefinitions,
  workspace,
  editor,
  permissions,
  mcp: () => mcp,
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
  })
  onWorkspaceFsChange(() => review.notifyFsChange())
}

export async function stopAgentServices(): Promise<void> {
  agents.disposeAll()
  await mcp?.close()
  mcp = null
}

export function registerAgentHandlers(): void {
  handle('editor:snapshot', (_e, snapshot) => editor.update(snapshot))

  handle('agent:list', () => agents.list())
  handle('agent:status', (_e, agentId) => agents.status(agentId))
  handle('agent:newSession', (_e, agentId) => agents.newSession(agentId))
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

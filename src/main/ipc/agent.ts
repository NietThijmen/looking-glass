import { AgentManager } from '../acp/AgentManager'
import { loadAgentDefinitions } from '../acp/registry'
import { EditorState } from '../editor/EditorState'
import { startEditorMcpServer, type EditorMcpHandle } from '../mcp/editorMcpServer'
import { PermissionService } from '../permissions/PermissionService'
import { broadcast } from './broadcast'
import { handle } from './typed'
import { git, onWorkspaceWillChange, terminals, workspace } from './workspace'

const editor = new EditorState()
const permissions = new PermissionService(
  (request) => broadcast('agent:permission', request),
  (requestId) => broadcast('agent:permissionResolved', { requestId }),
)
let mcp: EditorMcpHandle | null = null

export const agents = new AgentManager({
  definitions: loadAgentDefinitions,
  workspace,
  editor,
  permissions,
  mcp: () => mcp,
  onStatus: (agentId, status) => broadcast('agent:status', { agentId, status }),
  onSessionUpdate: ({ sessionId, update }) => broadcast('agent:update', { sessionId, update }),
})

export async function startAgentServices(): Promise<void> {
  try {
    mcp = await startEditorMcpServer({
      workspace: () => workspace.info,
      editor,
      gitStatus: async () => (workspace.root ? git.status(workspace.root) : null),
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
  })
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
  handle('agent:startTerminalAuth', async (_e, agentId, methodId) => {
    const command = await agents.terminalAuthCommand(agentId, methodId)
    const info = terminals.create(workspace.root, { cols: 100, rows: 30 }, command)
    broadcast('terminal:opened', info)
    return info
  })
}

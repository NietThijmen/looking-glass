import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { formatDiagnostics, type DiagnosticsByPath } from '@lookingglass/shared/diagnostics'
import type { GitStatus, WorkspaceInfo } from '@lookingglass/shared/ipc'
import { registerBrowserTools, type BrowserToolDeps } from '../browser/browserTools'
import type { EditorState } from '@lookingglass/workspace'

export interface EditorMcpDeps {
  workspace(): WorkspaceInfo | null
  editor: EditorState
  gitStatus(): Promise<GitStatus | null>
  openFile(path: string, line?: number): Promise<void>
  /** Language-server diagnostics: one file (opened on demand), or everything currently known. */
  diagnostics?(path?: string): Promise<DiagnosticsByPath>
  browser?: BrowserToolDeps
}

export interface EditorMcpHandle {
  url: string
  /** Header that must accompany every request. */
  headers: Array<{ name: string; value: string }>
  close(): Promise<void>
}

const text = (value: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
})

function buildServer(deps: EditorMcpDeps): McpServer {
  const server = new McpServer({ name: 'lookingglass', version: '0.0.1' })

  server.registerTool(
    'get_workspace_info',
    { description: 'The folder open in the Lookingglass editor.', inputSchema: {} },
    async () => text(deps.workspace() ?? 'No folder is open.'),
  )
  server.registerTool(
    'get_open_editors',
    {
      description:
        'Files open in the editor, which one is active, and which have unsaved changes. Paths are relative to the workspace root.',
      inputSchema: {},
    },
    async () => {
      const { openFiles, activeFile, dirty } = deps.editor.snapshot
      return text({ openFiles, activeFile, unsavedFiles: Object.keys(dirty) })
    },
  )
  server.registerTool(
    'get_git_status',
    { description: 'Current branch and changed files in the workspace.', inputSchema: {} },
    async () => text((await deps.gitStatus()) ?? 'The workspace is not a git repository.'),
  )
  server.registerTool(
    'open_file',
    {
      description: 'Open a workspace file in the editor for the user, optionally at a 1-based line.',
      inputSchema: {
        path: z.string().describe('Path relative to the workspace root'),
        line: z.number().int().min(1).optional(),
      },
    },
    async ({ path, line }) => {
      await deps.openFile(path, line)
      return text(`Opened ${path}${line ? `:${line}` : ''}`)
    },
  )
  const { diagnostics } = deps
  if (diagnostics)
    server.registerTool(
      'get_diagnostics',
      {
        description:
          "Errors and warnings from the editor's language server (TypeScript/JavaScript), including unsaved edits. With a path, checks that file (it doesn't need to be open); without one, lists problems in the files open in the editor. Positions are 1-based.",
        inputSchema: { path: z.string().optional().describe('Path relative to the workspace root') },
      },
      async ({ path }) => text(formatDiagnostics(await diagnostics(path))),
    )
  if (deps.browser) registerBrowserTools(server, deps.browser)
  return server
}

/**
 * The built-in MCP server handed to every agent session, so any ACP agent gets
 * editor-aware tools. Streamable HTTP on loopback, guarded by a random bearer
 * token; each request gets a fresh stateless server instance.
 */
export async function startEditorMcpServer(deps: EditorMcpDeps): Promise<EditorMcpHandle> {
  const token = randomBytes(24).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)

  const httpServer = http.createServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '')
    if (req.url !== '/mcp' || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401).end()
      return
    }
    const server = buildServer(deps)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error('[mcp]', error)
      if (!res.headersSent) res.writeHead(500).end()
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const { port } = httpServer.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    close: () => new Promise((resolve) => httpServer.close(() => resolve())),
  }
}

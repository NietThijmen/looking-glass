import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { formatDiagnostics, type DiagnosticsByPath } from '@lookingglass/shared/diagnostics'
import type { GitStatus, WorkspaceInfo } from '@lookingglass/shared/ipc'
import { registerBrowserTools, type BrowserToolDeps } from '../browser/browserTools'
import type { EditorState } from '@lookingglass/workspace'
import { serveMcp, type McpHandle } from './http'
import { ToolSet } from './toolSet'

export interface EditorMcpDeps {
  workspace(): WorkspaceInfo | null
  editor: EditorState
  gitStatus(): Promise<GitStatus | null>
  openFile(path: string, line?: number): Promise<void>
  /** Language-server diagnostics: one file (opened on demand), or everything currently known. */
  diagnostics?(path?: string): Promise<DiagnosticsByPath>
  browser?: BrowserToolDeps
}

export type EditorMcpHandle = McpHandle

const text = (value: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
})

const PREAMBLE =
  'You are running inside Lookingglass, a code editor with a built-in browser. This server (`lookingglass`) gives you tools for what the user has open in it. They are your first choice for anything in the editor or its browser:'

const POSTAMBLE = [
  'Prefer these tools over any other tool that does the same job. Use the `lookingglass` browser tools, not a separate browser, Playwright, or fetching the page with curl or a web tool. Use `open_file` to show code to the user, and `get_git_status` and `get_diagnostics` before running git or a type checker in a shell. Fall back to other tools only when these cannot do it.',
  'When a question is about a page the user has open, inspect the live page with the browser tools instead of guessing. A prompt may already include an element the user picked in the browser (selector, HTML, matched CSS, screenshot) as context.',
  'Some of these tools may be deferred in your client. Load their schemas first (for example with a tool search) before calling them.',
].join('\n')

function buildServer(deps: EditorMcpDeps): McpServer {
  const tools = new ToolSet()
  tools.add(
    'get_workspace_info',
    {
      usage: 'The folder open in the editor. Use it to learn the project root.',
      description: 'The folder open in the Lookingglass editor.',
      inputSchema: {},
    },
    async () => text(deps.workspace() ?? 'No folder is open.'),
  )
  tools.add(
    'get_open_editors',
    {
      usage:
        "The files the user has open, which is active, and which have unsaved changes. Use it to see what they're working on; unsaved edits aren't on disk yet.",
      description:
        'Files open in the editor, which one is active, and which have unsaved changes. Paths are relative to the workspace root.',
      inputSchema: {},
    },
    async () => {
      const { openFiles, activeFile, dirty } = deps.editor.snapshot
      return text({ openFiles, activeFile, unsavedFiles: Object.keys(dirty) })
    },
  )
  tools.add(
    'get_git_status',
    {
      usage: 'The current branch and changed files. Use it for what has changed so far.',
      description: 'Current branch and changed files in the workspace.',
      inputSchema: {},
    },
    async () => text((await deps.gitStatus()) ?? 'The workspace is not a git repository.'),
  )
  tools.add(
    'open_file',
    {
      usage:
        "Show a file to the user in the editor, optionally at a 1-based line. Use it to point at the code you're talking about.",
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
    tools.add(
      'get_diagnostics',
      {
        usage:
          'Language-server errors and warnings (TypeScript/JavaScript), including unsaved edits. Run it on files you changed to check your work; give a path or omit it for the open files.',
        description:
          "Errors and warnings from the editor's language server (TypeScript/JavaScript), including unsaved edits. With a path, checks that file (it doesn't need to be open); without one, lists problems in the files open in the editor. Positions are 1-based.",
        inputSchema: { path: z.string().optional().describe('Path relative to the workspace root') },
      },
      async ({ path }) => text(formatDiagnostics(await diagnostics(path))),
    )
  if (deps.browser) registerBrowserTools(tools, deps.browser)
  const server = new McpServer(
    { name: 'lookingglass', version: '0.0.1' },
    { instructions: tools.instructions(PREAMBLE, POSTAMBLE) },
  )
  tools.install(server)
  return server
}

/**
 * The built-in MCP server handed to every agent session, so any ACP agent gets
 * editor-aware tools.
 */
export function startEditorMcpServer(deps: EditorMcpDeps): Promise<EditorMcpHandle> {
  return serveMcp('mcp', () => buildServer(deps))
}

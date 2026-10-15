import type { McpServer as SessionMcpServer } from '@agentclientprotocol/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SubagentService } from '@lookingglass/acp'
import { serveMcp, type McpHandle } from './http'
import { ToolSet } from './toolSet'

/** Tells the server which session is calling; each session gets its own value. */
const CALLER_HEADER = 'x-lookingglass-caller'

export interface SubagentMcpHandle extends McpHandle {
  /**
   * The server entry for one chat session. `bind` it to the session's id once known;
   * requests carrying an unbound or revoked entry are refused.
   */
  grant(): { server: SessionMcpServer; bind(sessionId: string): void }
  /** Forget every session, e.g. when the workspace changes. */
  revokeAll(): void
}

const text = (value: unknown, isError = false) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
  ...(isError ? { isError: true } : {}),
})

const PREAMBLE =
  'This server (`subagents`) lets you hand a task to another agent configured for this project, such as a cheaper model or a specialist. Each call runs in a fresh session that only sees your prompt, so include the context it needs:'

const POSTAMBLE =
  "Sub-agents work in the same project folder; their edits and commands still need the user's permission. They can't delegate further."

function buildServer(subagents: SubagentService, parentSessionId: string | undefined): McpServer {
  const parent = () => {
    if (!parentSessionId) throw new Error('This session is not allowed to start sub-agents.')
    return parentSessionId
  }
  const tools = new ToolSet()
  tools.add(
    'subagent_execute',
    {
      usage:
        'Run a prompt with a target agent and get its final reply. `target` is a name from subagent_list, or `@agent/model` (e.g. `@claude/claude-sonnet-5`) for any configured agent and model; omit it for the default. Give it a role and a self-contained prompt.',
      description:
        "Run a prompt in a fresh session of the agent mapped to `target` and return its final reply. Blocks until the sub-agent's turn ends, it times out, or it is cancelled.",
      inputSchema: {
        target: z
          .string()
          .optional()
          .describe(
            'Target name from subagent_list, or "@agent/model" / "@agent"; defaults to defaultTarget',
          ),
        role: z.string().optional().describe('Role for the sub-agent, e.g. "Security auditor"'),
        prompt: z
          .string()
          .min(1)
          .describe('The task. The sub-agent sees nothing else from this conversation.'),
      },
    },
    async ({ target, role, prompt }, extra) => {
      try {
        const result = await subagents.execute(
          parent(),
          { prompt, ...(target ? { target } : {}), ...(role ? { role } : {}) },
          extra.signal,
        )
        if (result.stopReason === 'end_turn') return text(result.text || '(The sub-agent gave no reply.)')
        return text(result, result.stopReason === 'error')
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error), true)
      }
    },
  )
  tools.add(
    'subagent_list',
    {
      usage: 'The targets you can delegate to.',
      description: 'Configured targets, the agent each maps to, and whether it is available.',
      inputSchema: {},
    },
    async () => {
      parent()
      return text(await subagents.targets())
    },
  )
  const server = new McpServer(
    { name: 'subagents', version: '0.0.1' },
    { instructions: tools.instructions(PREAMBLE, POSTAMBLE) },
  )
  tools.install(server)
  return server
}

/** Sub-agent tools for agent sessions in workspaces that switch them on. */
export async function startSubagentMcpServer(subagents: SubagentService): Promise<SubagentMcpHandle> {
  /** Caller header value → the session it was granted to. */
  const parents = new Map<string, string>()
  const handle = await serveMcp('subagents', (req) => {
    const caller = req.headers[CALLER_HEADER]
    return buildServer(subagents, typeof caller === 'string' ? parents.get(caller) : undefined)
  })
  return {
    ...handle,
    grant() {
      const caller = randomUUID()
      return {
        server: {
          type: 'http',
          name: 'subagents',
          url: handle.url,
          headers: [...handle.headers, { name: CALLER_HEADER, value: caller }],
        },
        bind: (sessionId) => void parents.set(caller, sessionId),
      }
    },
    revokeAll: () => parents.clear(),
  }
}

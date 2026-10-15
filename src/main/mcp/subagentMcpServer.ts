import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CALLER_HEADER, type SubagentService } from '@lookingglass/acp'
import { serveMcp, type McpHandle } from './http'
import { ToolSet } from './toolSet'

export interface SubagentMcpDeps {
  subagents: SubagentService
  /** The session behind a caller header (see `AgentManager.sessionForCaller`). */
  sessionForCaller(caller: string): string | undefined
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

function buildServer(deps: SubagentMcpDeps, caller: string | undefined): McpServer {
  const { subagents } = deps
  const parent = () => {
    const sessionId = caller && deps.sessionForCaller(caller)
    if (!sessionId) throw new Error('This session is not allowed to start sub-agents.')
    return sessionId
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
      usage: 'The targets you can delegate to, and your sub-agents that are still running.',
      description:
        'Configured targets, the agent each maps to, whether it is available, and running sub-agents.',
      inputSchema: {},
    },
    async () => text({ targets: await subagents.targets(), running: subagents.running(parent()) }),
  )
  tools.add(
    'subagent_cancel',
    {
      description: 'Cancel a running sub-agent by the id from subagent_list.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const own = subagents.running(parent()).some((r) => r.id === id)
      return own && (await subagents.cancel(id))
        ? text(`Cancelled ${id}`)
        : text(`No running sub-agent ${id}`, true)
    },
  )
  tools.add(
    'subagent_capabilities',
    {
      description:
        'What each target agent supports (prompt content types, MCP transports, resuming sessions). Starts agents that are not running yet.',
      inputSchema: {},
    },
    async () => text(await subagents.capabilities()),
  )
  const server = new McpServer(
    { name: 'subagents', version: '0.0.1' },
    { instructions: tools.instructions(PREAMBLE, POSTAMBLE) },
  )
  tools.install(server)
  return server
}

/** Sub-agent tools for agent sessions in workspaces that switch them on. */
export function startSubagentMcpServer(deps: SubagentMcpDeps): Promise<McpHandle> {
  return serveMcp('subagents', (req) => {
    const caller = req.headers[CALLER_HEADER.toLowerCase()]
    return buildServer(deps, typeof caller === 'string' ? caller : undefined)
  })
}

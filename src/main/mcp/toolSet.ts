import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'

type ToolConfig<Input extends ZodRawShapeCompat | undefined> = {
  description: string
  inputSchema?: Input
  /**
   * Guidance for the agent beyond the description: when to reach for the tool,
   * what to call first, what needs the user's approval. Shown in the server
   * instructions.
   */
  usage?: string
}

/**
 * The tools of one MCP server, collected before the server exists. The server's
 * `instructions` can only be set when it is constructed, so tools are declared
 * here first, the instructions are generated from what was declared, and then
 * `install` registers them. That keeps the instructions in step with the tools
 * (a tool that isn't registered isn't mentioned).
 */
export class ToolSet {
  readonly #docs: Array<{ name: string; summary: string }> = []
  readonly #installs: Array<(server: McpServer) => void> = []

  add<Input extends ZodRawShapeCompat | undefined = undefined>(
    name: string,
    { usage, ...config }: ToolConfig<Input>,
    cb: ToolCallback<Input>,
  ): void {
    this.#docs.push({ name, summary: usage ?? config.description })
    this.#installs.push((server) => server.registerTool(name, config, cb))
  }

  install(server: McpServer): void {
    for (const install of this.#installs) install(server)
  }

  /** `preamble`, one line per tool in registration order, then `postamble`. */
  instructions(preamble: string, postamble = ''): string {
    const lines = this.#docs.map(({ name, summary }) => `- ${name}: ${summary}`)
    return [preamble, ...lines, postamble].filter(Boolean).join('\n')
  }
}

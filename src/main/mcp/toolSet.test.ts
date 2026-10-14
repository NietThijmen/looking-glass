import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolSet } from './toolSet'

describe('ToolSet', () => {
  it('lists each tool in order, using usage over description', () => {
    const tools = new ToolSet()
    tools.add('first', { description: 'Does one thing.' }, async () => ({ content: [] }))
    tools.add(
      'second',
      { description: 'Does another.', usage: 'Call after first.', inputSchema: { n: z.number() } },
      async () => ({ content: [] }),
    )
    expect(tools.instructions('Intro', 'Outro')).toBe(
      'Intro\n- first: Does one thing.\n- second: Call after first.\nOutro',
    )
  })

  it('registers every tool on the server without leaking usage into the schema', async () => {
    const tools = new ToolSet()
    tools.add('first', { description: 'Does one thing.', usage: 'Hint.' }, async () => ({ content: [] }))
    const server = new McpServer({ name: 't', version: '0' })
    tools.install(server)
    const registered = (server as unknown as { _registeredTools: Record<string, { description?: string }> })
      ._registeredTools
    expect(Object.keys(registered)).toEqual(['first'])
    expect(registered.first?.description).toBe('Does one thing.')
  })
})

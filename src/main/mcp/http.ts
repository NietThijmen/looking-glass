import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface McpHandle {
  url: string
  /** Header that must accompany every request. */
  headers: Array<{ name: string; value: string }>
  close(): Promise<void>
}

/**
 * Serve MCP over Streamable HTTP on loopback, guarded by a random bearer token.
 * Each request gets a fresh stateless server instance from `build`.
 */
export async function serveMcp(
  name: string,
  build: (req: http.IncomingMessage) => McpServer,
): Promise<McpHandle> {
  const token = randomBytes(24).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)

  const httpServer = http.createServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '')
    if (req.url !== '/mcp' || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401).end()
      return
    }
    const server = build(req)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error(`[${name}]`, error)
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

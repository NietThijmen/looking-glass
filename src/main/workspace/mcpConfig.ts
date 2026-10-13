import type { McpServer } from '@agentclientprotocol/sdk'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Name of the built-in editor server; a workspace can't reuse it. */
export const BUILT_IN_MCP_NAME = 'lookingglass'

interface StdioEntry {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface RemoteEntry {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

const pairs = (record: Record<string, string> | undefined): Array<{ name: string; value: string }> =>
  Object.entries(record ?? {})
    .filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => ({ name, value }))

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

/**
 * `mcpServers` from `<workspace>/.lookingglass/settings.json`, in the same shape
 * most agents use:
 *
 *   { "mcpServers": {
 *       "db": { "command": "npx", "args": ["my-db-mcp"], "env": { "DB_URL": "…" } },
 *       "docs": { "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "…" } } } }
 *
 * Invalid entries are skipped with a warning.
 */
export function parseMcpServers(settings: unknown): McpServer[] {
  const raw = (settings as { mcpServers?: unknown } | null)?.mcpServers
  if (!raw || typeof raw !== 'object') return []
  const servers: McpServer[] = []
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Partial<StdioEntry & RemoteEntry> | null
    if (name === BUILT_IN_MCP_NAME || !e || typeof e !== 'object') {
      console.warn(`[mcp] ignoring workspace MCP server "${name}"`)
      continue
    }
    if ((e.type === 'http' || e.type === 'sse') && typeof e.url === 'string') {
      servers.push({ type: e.type, name, url: e.url, headers: pairs(e.headers) })
    } else if (typeof e.command === 'string' && (e.args === undefined || strings(e.args))) {
      servers.push({ name, command: e.command, args: e.args ?? [], env: pairs(e.env) })
    } else {
      console.warn(`[mcp] ignoring workspace MCP server "${name}": needs "command", or "type" and "url"`)
    }
  }
  return servers
}

export async function readWorkspaceMcpServers(root: string): Promise<McpServer[]> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(root, '.lookingglass', 'settings.json'), 'utf8')
  } catch {
    return []
  }
  try {
    return parseMcpServers(JSON.parse(raw))
  } catch (error) {
    console.warn('[mcp] could not parse .lookingglass/settings.json:', error)
    return []
  }
}

/** Identifies an exact server list, so changing it asks the user again. */
export function mcpServersHash(servers: McpServer[]): string {
  return createHash('sha256').update(JSON.stringify(servers)).digest('hex')
}

/** One line per server for the approval prompt. Header and env values are left out. */
export function describeMcpServers(servers: McpServer[]): string {
  return servers
    .map((s) => {
      if ('url' in s) return `${s.name}: ${s.type} ${s.url}`
      if (!('command' in s)) return s.name
      const env = s.env.length ? ` (env: ${s.env.map((e) => e.name).join(', ')})` : ''
      return `${s.name}: ${[s.command, ...s.args].join(' ')}${env}`
    })
    .join('\n')
}

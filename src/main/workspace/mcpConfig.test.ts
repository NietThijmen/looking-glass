import { describe, expect, it } from 'vitest'
import { describeMcpServers, mcpServersHash, parseMcpServers } from './mcpConfig'

describe('parseMcpServers', () => {
  it('reads stdio and remote servers in ACP shape', () => {
    const servers = parseMcpServers({
      mcpServers: {
        db: { command: 'npx', args: ['db-mcp'], env: { DB_URL: 'postgres://x' } },
        docs: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer t' } },
      },
    })
    expect(servers).toEqual([
      { name: 'db', command: 'npx', args: ['db-mcp'], env: [{ name: 'DB_URL', value: 'postgres://x' }] },
      {
        type: 'http',
        name: 'docs',
        url: 'https://example.com/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer t' }],
      },
    ])
  })

  it('skips invalid entries and the built-in name', () => {
    expect(
      parseMcpServers({
        mcpServers: {
          lookingglass: { command: 'x' },
          bad: { args: ['a'] },
          worse: null,
          ok: { command: 'y' },
        },
      }),
    ).toEqual([{ name: 'ok', command: 'y', args: [], env: [] }])
    expect(parseMcpServers({})).toEqual([])
    expect(parseMcpServers(null)).toEqual([])
  })

  it('describes servers without secrets and hashes the exact list', () => {
    const servers = parseMcpServers({
      mcpServers: { db: { command: 'npx', args: ['db-mcp'], env: { DB_URL: 'secret' } } },
    })
    expect(describeMcpServers(servers)).toBe('db: npx db-mcp (env: DB_URL)')
    const other = parseMcpServers({ mcpServers: { db: { command: 'npx', args: ['other'] } } })
    expect(mcpServersHash(servers)).not.toBe(mcpServersHash(other))
  })
})

import { app } from 'electron'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDev, isSmokeTest } from '../env'
import type { AgentDefinition } from './definition'

const require = createRequire(import.meta.url)

/** Run a bundled Node script with Electron's own Node, so users don't need Node installed. */
function electronNode(
  script: string,
  env: Record<string, string> = {},
): Pick<AgentDefinition, 'command' | 'args' | 'env'> {
  const bootstrap = fileURLToPath(new URL('./nodeBootstrap.js', import.meta.url))
  return {
    command: process.execPath,
    args: [bootstrap, script],
    env: { ELECTRON_RUN_AS_NODE: '1', ...env },
  }
}

function unpacked(p: string): string {
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
}

/** Node-style lookup of `rel` in `dir` and its ancestors. (The SDK's package.json isn't exported, so it can't be resolved.) */
function findUp(dir: string, rel: string): string | null {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, rel)
    if (existsSync(unpacked(candidate)) || existsSync(candidate)) return candidate
    if (path.dirname(current) === current) return null
  }
}

function claudeCode(): AgentDefinition {
  const pkg = require.resolve('@agentclientprotocol/claude-agent-acp/package.json')
  const env: Record<string, string> = {}
  if (app.isPackaged) {
    // The adapter spawns the Claude CLI binary shipped with the Agent SDK; executables
    // can't run from inside app.asar, so point it at the unpacked copy.
    const binary = findUp(
      path.dirname(pkg),
      path.join(
        'node_modules',
        '@anthropic-ai',
        `claude-agent-sdk-${process.platform}-${process.arch}`,
        `claude${process.platform === 'win32' ? '.exe' : ''}`,
      ),
    )
    if (binary) env['CLAUDE_CODE_EXECUTABLE'] = unpacked(binary)
  }
  return {
    id: 'claude-code',
    label: 'Claude Code',
    builtIn: true,
    ...electronNode(path.join(path.dirname(pkg), 'dist', 'index.js'), env),
  }
}

/** Scriptable test agent (see fakeAgent.ts). Only offered in dev and smoke runs. */
function fakeAgent(): AgentDefinition {
  return {
    id: 'fake',
    label: 'Fake agent (testing)',
    builtIn: true,
    ...electronNode(fileURLToPath(new URL('./fakeAgent.js', import.meta.url))),
  }
}

interface UserAgentConfig {
  label?: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** `~/.lookingglass/agents.json`: `{ "<id>": { label, command, args, env } }`. */
async function userAgents(): Promise<AgentDefinition[]> {
  const file = path.join(os.homedir(), '.lookingglass', 'agents.json')
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, UserAgentConfig>
    return Object.entries(parsed)
      .filter(([, c]) => typeof c?.command === 'string')
      .map(([id, c]) => ({
        id,
        label: c.label ?? id,
        command: c.command,
        args: c.args ?? [],
        ...(c.env ? { env: c.env } : {}),
        builtIn: false,
      }))
  } catch (error) {
    console.warn(`[agents] ignoring invalid ${file}:`, error)
    return []
  }
}

export async function loadAgentDefinitions(): Promise<AgentDefinition[]> {
  const builtIns = [claudeCode(), ...(isDev || isSmokeTest ? [fakeAgent()] : [])]
  const custom = (await userAgents()).filter((a) => !builtIns.some((b) => b.id === a.id))
  return [...builtIns, ...custom]
}

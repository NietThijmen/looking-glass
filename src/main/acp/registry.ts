import { app } from 'electron'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDev, isSmokeTest } from '../env'
import type { CustomAgentConfig } from '@lookingglass/shared/settings'
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

/** `LOOKINGGLASS_HOME` moves it (smoke runs use a throwaway folder). */
export const agentsFile = (): string =>
  path.join(process.env['LOOKINGGLASS_HOME'] ?? path.join(os.homedir(), '.lookingglass'), 'agents.json')

/** `~/.lookingglass/agents.json`: `{ "<id>": { label, command, args, env } }`. */
export async function readCustomAgents(): Promise<{ agents: CustomAgentConfig[]; error: string | null }> {
  let raw: string
  try {
    raw = await fs.readFile(agentsFile(), 'utf8')
  } catch {
    return { agents: [], error: null }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, UserAgentConfig>
    const agents = Object.entries(parsed)
      .filter(([, c]) => typeof c?.command === 'string')
      .map(([id, c]) => ({
        id,
        label: c.label ?? id,
        command: c.command,
        args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === 'string') : [],
        env: c.env && typeof c.env === 'object' ? c.env : {},
      }))
    return { agents, error: null }
  } catch (error) {
    return { agents: [], error: `${agentsFile()} is not valid JSON: ${String(error)}` }
  }
}

/** Replace the custom agent list. Ids of built-in agents are refused. */
export async function writeCustomAgents(agents: CustomAgentConfig[]): Promise<void> {
  const builtIn = new Set(['claude-code', 'fake'])
  const out: Record<string, UserAgentConfig> = {}
  for (const a of agents) {
    const id = a.id.trim()
    if (!id || builtIn.has(id)) throw new Error(`"${id || '(empty)'}" can't be used as an agent id.`)
    if (out[id]) throw new Error(`Two agents use the id "${id}".`)
    if (!a.command.trim()) throw new Error(`Agent "${id}" needs a command.`)
    out[id] = {
      label: a.label.trim() || id,
      command: a.command.trim(),
      ...(a.args.length ? { args: a.args } : {}),
      ...(Object.keys(a.env).length ? { env: a.env } : {}),
    }
  }
  await fs.mkdir(path.dirname(agentsFile()), { recursive: true })
  await fs.writeFile(agentsFile(), JSON.stringify(out, null, 2) + '\n')
}

async function userAgents(): Promise<AgentDefinition[]> {
  const { agents, error } = await readCustomAgents()
  if (error) console.warn(`[agents] ignoring ${error}`)
  return agents.map((a) => ({
    id: a.id,
    label: a.label,
    command: a.command,
    args: a.args,
    ...(Object.keys(a.env).length ? { env: a.env } : {}),
    builtIn: false,
  }))
}

export async function loadAgentDefinitions(): Promise<AgentDefinition[]> {
  const builtIns = [claudeCode(), ...(isDev || isSmokeTest ? [fakeAgent()] : [])]
  const custom = (await userAgents()).filter((a) => !builtIns.some((b) => b.id === a.id))
  return [...builtIns, ...custom]
}

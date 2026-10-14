import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { CustomAgentConfig } from '@lookingglass/shared/settings'
import type { AgentDefinition } from './definition'

/**
 * Packaging facts from the Electron app. This package does not import Electron;
 * the app fills these in and calls `loadAgentDefinitions`.
 */
export interface AgentRuntime {
  execPath: string
  isPackaged: boolean
  /** Map a path inside app.asar to the unpacked copy electron-builder produces. */
  unpackedPath(file: string): string
  /** Built `nodeBootstrap.js`, next to the main bundle. */
  nodeBootstrap: string
  /** Built `fakeAgent.js`, next to the main bundle. */
  fakeAgent: string
  /** Dev and smoke runs offer the scriptable fake agent. */
  includeFake: boolean
}

/** Node-style lookup of `rel` in `dir` and its ancestors. */
function findUp(dir: string, rel: string, unpackedPath: (file: string) => string): string | null {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, rel)
    if (existsSync(unpackedPath(candidate)) || existsSync(candidate)) return candidate
    if (path.dirname(current) === current) return null
  }
}

/** Run a bundled Node script with Electron's own Node, so users don't need Node installed. */
function electronNode(
  runtime: AgentRuntime,
  script: string,
  env: Record<string, string> = {},
): Pick<AgentDefinition, 'command' | 'args' | 'env'> {
  return {
    command: runtime.execPath,
    args: [runtime.nodeBootstrap, script],
    env: { ELECTRON_RUN_AS_NODE: '1', ...env },
  }
}

function claudeCode(runtime: AgentRuntime): AgentDefinition {
  // Resolve from the bootstrap path so lookup matches the built main process, which
  // lives next to it. The SDK's package.json isn't exported, so it can't be imported.
  const require = createRequire(runtime.nodeBootstrap)
  const pkg = require.resolve('@agentclientprotocol/claude-agent-acp/package.json')
  const env: Record<string, string> = {}
  if (runtime.isPackaged) {
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
      runtime.unpackedPath,
    )
    if (binary) env['CLAUDE_CODE_EXECUTABLE'] = runtime.unpackedPath(binary)
  }
  return {
    id: 'claude-code',
    label: 'Claude Code',
    builtIn: true,
    ...electronNode(runtime, path.join(path.dirname(pkg), 'dist', 'index.js'), env),
  }
}

/** Scriptable test agent (see fakeAgent.ts). Only offered when the app asks for it. */
export function fakeAgentDefinition(runtime: AgentRuntime): AgentDefinition {
  return {
    id: 'fake',
    label: 'Fake agent (testing)',
    builtIn: true,
    ...electronNode(runtime, runtime.fakeAgent),
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

export async function loadAgentDefinitions(runtime: AgentRuntime): Promise<AgentDefinition[]> {
  const builtIns = [claudeCode(runtime), ...(runtime.includeFake ? [fakeAgentDefinition(runtime)] : [])]
  const custom = (await userAgents()).filter((a) => !builtIns.some((b) => b.id === a.id))
  return [...builtIns, ...custom]
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/** An agent, optionally with the model to switch its session to. */
export interface AgentRef {
  agentId: string
  model: string | null
}

/** Short names for built-in agents. */
const AGENT_ALIASES: Record<string, string> = { claude: 'claude-code' }

/**
 * `@<agent>/<model>` or `@<agent>`, e.g. `@claude/claude-sonnet-5` or `@codex/gpt-5.5-astra`.
 * The leading `@` is optional; everything after the first `/` is the model.
 */
export function parseAgentRef(ref: string): AgentRef | null {
  const body = ref.trim().replace(/^@/, '')
  const slash = body.indexOf('/')
  const agent = (slash === -1 ? body : body.slice(0, slash)).trim()
  const model = slash === -1 ? '' : body.slice(slash + 1).trim()
  if (!agent || (slash !== -1 && !model)) return null
  return { agentId: AGENT_ALIASES[agent] ?? agent, model: model || null }
}

export interface SubagentSettings {
  enabled: boolean
  /** Target name → agent ref (`@agent/model`, `@agent` or a bare agent id). */
  targets: Record<string, string>
  defaultTarget: string | null
  timeoutSeconds: number
}

const DEFAULT_TIMEOUT_SECONDS = 600

/** Fields that are missing or the wrong type fall back to their defaults. */
const SettingsFile = z.object({
  subagents: z.object({
    enabled: z.boolean().catch(false),
    targets: z.record(z.string(), z.unknown()).catch({}),
    defaultTarget: z.string().nullable().catch(null),
    timeoutSeconds: z.number().positive().catch(DEFAULT_TIMEOUT_SECONDS),
  }),
})

const TargetRef = z
  .string()
  .trim()
  .refine((value) => parseAgentRef(value) !== null)

/**
 * `subagents` from `<workspace>/.lookingglass/settings.json`:
 *
 *   { "subagents": { "enabled": true, "targets": { "coder": "claude-code" }, "defaultTarget": "coder" } }
 *
 * Returns null when the section is missing. Invalid targets are skipped with a warning.
 */
export function parseSubagentSettings(settings: unknown): SubagentSettings | null {
  const parsed = SettingsFile.safeParse(settings)
  if (!parsed.success) return null
  const { enabled, targets: raw, defaultTarget, timeoutSeconds } = parsed.data.subagents
  const targets: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    const ref = TargetRef.safeParse(value)
    if (ref.success) targets[name] = ref.data
    else console.warn(`[subagents] ignoring target "${name}": needs "@agent/model" or an agent id`)
  }
  return {
    enabled,
    targets,
    defaultTarget: defaultTarget && defaultTarget in targets ? defaultTarget : null,
    timeoutSeconds,
  }
}

export async function readWorkspaceSubagentSettings(root: string): Promise<SubagentSettings | null> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(root, '.lookingglass', 'settings.json'), 'utf8')
  } catch {
    return null
  }
  try {
    return parseSubagentSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

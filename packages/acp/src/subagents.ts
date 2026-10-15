import type { SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentSummary,
  AuthRequired,
  ContentBlock,
  NewSessionResult,
  PermissionRequest,
  PromptResult,
} from '@lookingglass/shared/agent'

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

/**
 * `subagents` from `<workspace>/.lookingglass/settings.json`:
 *
 *   { "subagents": { "enabled": true, "targets": { "coder": "claude-code" }, "defaultTarget": "coder" } }
 *
 * Returns null when the section is missing or malformed.
 */
export function parseSubagentSettings(settings: unknown): SubagentSettings | null {
  const raw = (settings as { subagents?: unknown } | null)?.subagents
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const targets: Record<string, string> = {}
  if (s['targets'] && typeof s['targets'] === 'object') {
    for (const [name, agentId] of Object.entries(s['targets'] as Record<string, unknown>)) {
      if (typeof agentId === 'string' && parseAgentRef(agentId)) targets[name] = agentId.trim()
      else console.warn(`[subagents] ignoring target "${name}": needs "@agent/model" or an agent id`)
    }
  }
  const defaultTarget = typeof s['defaultTarget'] === 'string' ? s['defaultTarget'] : null
  const timeout = s['timeoutSeconds']
  return {
    enabled: s['enabled'] === true,
    targets,
    defaultTarget: defaultTarget && defaultTarget in targets ? defaultTarget : null,
    timeoutSeconds:
      typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_TIMEOUT_SECONDS,
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

/** The parts of `AgentManager` sub-agents use. */
export interface SubagentAgents {
  list(): Promise<AgentSummary[]>
  newSession(agentId: string, options: { subagent: true }): Promise<NewSessionResult | AuthRequired>
  prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult>
  cancel(sessionId: string): Promise<void>
  setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[]>
  capabilities(agentId: string): Promise<Record<string, unknown>>
}

export interface SubagentDeps {
  agents: SubagentAgents
  settings(): Promise<SubagentSettings | null>
}

export interface SubagentTarget {
  target: string
  agentId: string
  model: string | null
  label: string | null
  available: boolean
  isDefault: boolean
}

export interface SubagentResult {
  id: string
  target: string
  agentId: string
  model: string | null
  stopReason: PromptResult['stopReason'] | 'timeout'
  text: string
  error?: string
}

interface Run {
  id: string
  target: string
  agentId: string
  model: string | null
  parentSessionId: string
  sessionId: string | null
  text: string[]
  cancelled: boolean
}

/**
 * Runs prompts from one agent session (the parent) in fresh sessions of other
 * agents, as configured by the workspace's `subagents` settings, and returns
 * their replies. Sub-agent sessions don't get the sub-agent tools themselves.
 */
export class SubagentService {
  #runs = new Map<string, Run>()
  #bySession = new Map<string, Run>()

  constructor(private readonly deps: SubagentDeps) {}

  /** Settings when sub-agents are switched on for this workspace. */
  async enabled(): Promise<SubagentSettings | null> {
    const settings = await this.deps.settings()
    return settings?.enabled ? settings : null
  }

  async targets(): Promise<SubagentTarget[]> {
    const settings = await this.enabled()
    if (!settings) return []
    const agents = await this.deps.agents.list()
    return Object.entries(settings.targets).map(([target, value]) => {
      const { agentId, model } = parseAgentRef(value)!
      const agent = agents.find((a) => a.id === agentId)
      return {
        target,
        agentId,
        model,
        label: agent?.label ?? null,
        available: !!agent,
        isDefault: settings.defaultTarget === target,
      }
    })
  }

  running(
    parentSessionId?: string,
  ): Array<{ id: string; target: string; agentId: string; model: string | null }> {
    return [...this.#runs.values()]
      .filter((r) => !parentSessionId || r.parentSessionId === parentSessionId)
      .map(({ id, target, agentId, model }) => ({ id, target, agentId, model }))
  }

  async capabilities(): Promise<Array<SubagentTarget & { capabilities: Record<string, unknown> | null }>> {
    return Promise.all(
      (await this.targets()).map(async (t) => ({
        ...t,
        capabilities: t.available ? await this.deps.agents.capabilities(t.agentId).catch(() => null) : null,
      })),
    )
  }

  async execute(
    parentSessionId: string,
    request: { target?: string; role?: string; prompt: string },
    signal?: AbortSignal,
  ): Promise<SubagentResult> {
    const settings = await this.enabled()
    if (!settings) throw new Error('Sub-agents are not enabled for this workspace.')
    const target = request.target?.trim() || settings.defaultTarget
    if (!target) throw new Error('No target given and no defaultTarget configured.')
    // `@agent/model` addresses an agent directly; anything else is a configured target name.
    const value = target.startsWith('@') ? target : settings.targets[target]
    if (!value) throw new Error(`Unknown target "${target}". Use subagent_list to see the targets.`)
    const ref = parseAgentRef(value)
    if (!ref) throw new Error(`"${value}" is not an agent; use "@agent/model" or "@agent".`)
    const { agentId, model } = ref
    if (!(await this.deps.agents.list()).some((a) => a.id === agentId)) {
      throw new Error(`Target "${target}" names agent "${agentId}", which isn't configured.`)
    }

    const run: Run = {
      id: randomUUID(),
      target,
      agentId,
      model,
      parentSessionId,
      sessionId: null,
      text: [],
      cancelled: false,
    }
    this.#runs.set(run.id, run)
    const onAbort = () => void this.cancel(run.id)
    signal?.addEventListener('abort', onAbort)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void this.cancel(run.id)
    }, settings.timeoutSeconds * 1000)
    try {
      const session = await this.deps.agents.newSession(agentId, { subagent: true })
      if ('authRequired' in session) {
        throw new Error(`${agentId} needs you to log in. Start a chat with it once to sign in.`)
      }
      run.sessionId = session.sessionId
      this.#bySession.set(session.sessionId, run)
      if (model) await this.#selectModel(session, model)
      if (run.cancelled) return this.#result(run, 'cancelled')

      const prompt: ContentBlock[] = [
        ...(request.role ? [{ type: 'text' as const, text: `You are acting as: ${request.role}.` }] : []),
        { type: 'text', text: request.prompt },
      ]
      const response = await this.deps.agents.prompt(session.sessionId, prompt)
      // Agents may finish the turn normally after a cancel; report what was asked for.
      const stopReason = timedOut ? 'timeout' : run.cancelled ? 'cancelled' : response.stopReason
      return this.#result(run, stopReason, response.error)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      this.#runs.delete(run.id)
      if (run.sessionId) this.#bySession.delete(run.sessionId)
    }
  }

  async cancel(id: string): Promise<boolean> {
    const run = this.#runs.get(id)
    if (!run) return false
    run.cancelled = true
    if (run.sessionId) await this.deps.agents.cancel(run.sessionId).catch(() => undefined)
    return true
  }

  /** Cancel everything a parent session started, e.g. when its own turn is cancelled. */
  async cancelChildren(parentSessionId: string): Promise<void> {
    await Promise.all(this.running(parentSessionId).map((r) => this.cancel(r.id)))
  }

  /** Collects a sub-agent's reply. Returns true when the update belongs to a sub-agent session. */
  handleUpdate({ sessionId, update }: SessionNotification): boolean {
    const run = this.#bySession.get(sessionId)
    if (!run) return false
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      run.text.push(update.content.text)
    }
    return true
  }

  /** A sub-agent's permission request, moved to its parent's chat and labelled with the target. */
  forParent(request: PermissionRequest): PermissionRequest {
    const run = this.#bySession.get(request.sessionId)
    if (!run) return request
    const title = request.toolCall.title ?? 'wants to run a tool'
    return {
      ...request,
      sessionId: run.parentSessionId,
      toolCall: { ...request.toolCall, title: `Sub-agent "${run.target}": ${title}` },
    }
  }

  /** Switch a fresh session to `model`, matched by value or name (case-insensitive). */
  async #selectModel(session: NewSessionResult, model: string): Promise<void> {
    const option = session.configOptions?.find(
      (o): o is Extract<SessionConfigOption, { type: 'select' }> =>
        o.category === 'model' && o.type === 'select',
    )
    if (!option) throw new Error(`${session.agentId} doesn't let clients pick a model.`)
    const choices = option.options.flatMap((o) => ('group' in o ? o.options : [o]))
    const wanted = model.toLowerCase()
    const choice =
      choices.find((c) => c.value === model) ??
      choices.find((c) => c.value.toLowerCase() === wanted || c.name.toLowerCase() === wanted)
    if (!choice) {
      throw new Error(
        `${session.agentId} has no model "${model}". Available: ${choices.map((c) => c.value).join(', ')}`,
      )
    }
    if (choice.value !== option.currentValue) {
      await this.deps.agents.setConfigOption(session.sessionId, option.id, choice.value)
    }
  }

  #result(run: Run, stopReason: SubagentResult['stopReason'], error?: string): SubagentResult {
    return {
      id: run.id,
      target: run.target,
      agentId: run.agentId,
      model: run.model,
      stopReason,
      text: run.text.join(''),
      ...(error ? { error } : {}),
    }
  }
}

import { RequestError, type McpServer, type SessionNotification } from '@agentclientprotocol/sdk'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentStatus,
  AgentSummary,
  AuthRequired,
  ContentBlock,
  NewSessionResult,
  PromptResult,
  SessionHistory,
} from '@lookingglass/shared/agent'
import type { EditorBuffers, FileHost, McpHost, ReviewHost, TerminalHost } from './hosts'
import type { PermissionService } from './PermissionService'
import { AcpClient } from './AcpClient'
import { summarize, type AgentDefinition } from './definition'

export interface AgentManagerDeps {
  definitions(): Promise<AgentDefinition[]>
  workspace: FileHost
  editor: EditorBuffers
  permissions: PermissionService
  mcp(): McpHost | null
  /** The workspace's own MCP servers, once the user has allowed them. */
  workspaceMcpServers?(): Promise<McpServer[]>
  onStatus(agentId: string, status: AgentStatus): void
  onSessionUpdate(notification: SessionNotification): void
  /** Optional so tests can run without them. */
  review?: ReviewHost
  terminals?: TerminalHost
  /** An agent wrote `path` through ACP (its contents already include any unsaved edits it read). */
  onAgentWrite?(path: string): void
}

/** 1-based `line` and `limit` as in `fs/read_text_file`. */
export function sliceLines(content: string, line?: number | null, limit?: number | null): string {
  if (!line && !limit) return content
  const lines = content.split('\n')
  const start = Math.max(0, (line ?? 1) - 1)
  const end = limit ? start + limit : undefined
  return lines.slice(start, end).join('\n')
}

const AUTH_REQUIRED_CODE = RequestError.authRequired().code
/** `session/list` pages to read; history beyond that is rarely what anyone is looking for. */
const MAX_HISTORY_PAGES = 5
const MAX_HISTORY = 50

interface RunningAgent {
  client: AcpClient
  ready: Promise<void>
}

/**
 * Owns agent processes (one per agent, shared by all its sessions) and routes
 * sessions to them. Agents are started lazily and restarted on next use after
 * they exit. All file access from agents goes through the file host.
 */
export class AgentManager {
  #running = new Map<string, RunningAgent>()
  #status = new Map<string, AgentStatus>()
  #sessions = new Map<string, string>()

  constructor(private readonly deps: AgentManagerDeps) {}

  async list(): Promise<AgentSummary[]> {
    return (await this.deps.definitions()).map(summarize)
  }

  status(agentId: string): AgentStatus {
    return this.#status.get(agentId) ?? { state: 'stopped' }
  }

  async newSession(agentId: string): Promise<NewSessionResult | AuthRequired> {
    const root = this.#root()
    const agent = await this.#ensure(agentId)
    try {
      const response = await agent.client.newSession(root, await this.#mcpServers(agent.client))
      this.#sessions.set(response.sessionId, agentId)
      return this.#sessionResult(agent.client, agentId, response.sessionId, response.modes)
    } catch (error) {
      return this.#authRequired(agent.client, agentId, error)
    }
  }

  /** Past sessions for this workspace, from the agent's own `session/list`. */
  async listSessions(agentId: string): Promise<SessionHistory> {
    const root = this.#root()
    const agent = await this.#ensure(agentId)
    const caps = agent.client.initializeResponse?.agentCapabilities
    if (!caps?.loadSession || !caps.sessionCapabilities?.list) return { supported: false, sessions: [] }
    const sessions: SessionHistory['sessions'] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_HISTORY_PAGES && sessions.length < MAX_HISTORY; page++) {
      const response = await agent.client.listSessions(root, cursor)
      for (const s of response.sessions) {
        sessions.push({
          sessionId: s.sessionId,
          agentId,
          title: s.title ?? null,
          updatedAt: s.updatedAt ?? null,
        })
      }
      if (!response.nextCursor) break
      cursor = response.nextCursor
    }
    sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    return { supported: true, sessions: sessions.slice(0, MAX_HISTORY) }
  }

  /** Resume a past session. Its history streams through `onSessionUpdate` before this resolves. */
  async loadSession(agentId: string, sessionId: string): Promise<NewSessionResult | AuthRequired> {
    const root = this.#root()
    const agent = await this.#ensure(agentId)
    if (!agent.client.initializeResponse?.agentCapabilities?.loadSession) {
      throw new Error('This agent cannot resume earlier sessions.')
    }
    // Mapped before the request: tool calls during the replay are routed by session.
    this.#sessions.set(sessionId, agentId)
    try {
      const response = await agent.client.loadSession(sessionId, root, await this.#mcpServers(agent.client))
      return this.#sessionResult(agent.client, agentId, sessionId, response.modes)
    } catch (error) {
      this.#sessions.delete(sessionId)
      return this.#authRequired(agent.client, agentId, error)
    }
  }

  async authenticate(agentId: string, methodId: string): Promise<void> {
    const agent = await this.#ensure(agentId)
    await agent.client.authenticate(methodId)
  }

  /** The command line for an agent's terminal-based login method (ACP `AuthMethodTerminal`). */
  async terminalAuthCommand(
    agentId: string,
    methodId: string,
  ): Promise<{ file: string; args: string[]; env: Record<string, string>; title: string }> {
    const definition = (await this.deps.definitions()).find((d) => d.id === agentId)
    const agent = await this.#ensure(agentId)
    const method = agent.client.initializeResponse?.authMethods?.find((m) => m.id === methodId)
    if (!definition || !method || !('type' in method) || method.type !== 'terminal') {
      throw new Error(`${agentId} has no terminal login method "${methodId}"`)
    }
    return {
      file: definition.command,
      args: [...definition.args, ...(method.args ?? [])],
      env: { ...definition.env, ...method.env },
      title: `${definition.label} login`,
    }
  }

  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult> {
    const client = this.#clientFor(sessionId)
    const checkpoint = (await this.deps.review?.beginTurn(sessionId)) ?? null
    try {
      const response = await client.prompt(sessionId, prompt)
      return { stopReason: response.stopReason, checkpoint }
    } catch (error) {
      return {
        stopReason: 'error',
        error: error instanceof Error ? error.message : String(error),
        checkpoint,
      }
    } finally {
      await this.deps.review?.endTurn(sessionId)
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.deps.permissions.cancelSession(sessionId)
    await this.#clientFor(sessionId).cancel(sessionId)
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.#clientFor(sessionId).setMode(sessionId, modeId)
  }

  /** Stop every agent, e.g. when the workspace changes (sessions are bound to a cwd). */
  disposeAll(): void {
    this.deps.permissions.cancelAll()
    this.deps.terminals?.releaseAll()
    for (const [agentId, agent] of this.#running) {
      agent.client.dispose()
      this.#setStatus(agentId, { state: 'stopped' })
    }
    this.#running.clear()
    this.#sessions.clear()
  }

  #root(): string {
    const root = this.deps.workspace.root
    if (!root) throw new Error('Open a folder before starting an agent session.')
    return root
  }

  #sessionResult(
    client: AcpClient,
    agentId: string,
    sessionId: string,
    modes: NewSessionResult['modes'] | undefined,
  ): NewSessionResult {
    const caps = client.initializeResponse?.agentCapabilities
    return {
      sessionId,
      agentId,
      modes: modes ?? null,
      promptCapabilities: caps?.promptCapabilities ?? {},
      canResume: caps?.loadSession === true,
    }
  }

  /** An `auth_required` error becomes the login prompt; anything else is rethrown. */
  #authRequired(client: AcpClient, agentId: string, error: unknown): AuthRequired {
    if (error instanceof RequestError && error.code === AUTH_REQUIRED_CODE) {
      return {
        authRequired: true,
        agentId,
        methods: client.initializeResponse?.authMethods ?? [],
        message: error.message,
      }
    }
    throw error
  }

  #requireTerminals(): TerminalHost {
    if (!this.deps.terminals) throw RequestError.methodNotFound('terminal/create')
    return this.deps.terminals
  }

  #clientFor(sessionId: string): AcpClient {
    const agentId = this.#sessions.get(sessionId)
    const agent = agentId ? this.#running.get(agentId) : undefined
    if (!agent) throw new Error('This session has ended. Start a new chat.')
    return agent.client
  }

  /** The built-in editor server plus the workspace's own, minus transports the agent can't use. */
  async #mcpServers(client: AcpClient): Promise<McpServer[]> {
    const caps = client.initializeResponse?.agentCapabilities?.mcpCapabilities
    const mcp = this.deps.mcp()
    const servers: McpServer[] = mcp
      ? [{ type: 'http', name: 'lookingglass', url: mcp.url, headers: mcp.headers }]
      : []
    servers.push(...((await this.deps.workspaceMcpServers?.()) ?? []))
    return servers.filter(
      (s) => !('type' in s) || (s.type === 'http' ? !!caps?.http : s.type === 'sse' ? !!caps?.sse : false),
    )
  }

  async #ensure(agentId: string): Promise<RunningAgent> {
    const existing = this.#running.get(agentId)
    if (existing) {
      await existing.ready
      return existing
    }

    const definition = (await this.deps.definitions()).find((d) => d.id === agentId)
    if (!definition) throw new Error(`Unknown agent: ${agentId}`)

    const client = new AcpClient(
      {
        command: definition.command,
        args: definition.args,
        ...(definition.env ? { env: definition.env } : {}),
        cwd: this.deps.workspace.root ?? process.cwd(),
      },
      {
        readTextFile: async ({ path: abs, line, limit }) => {
          const rel = await this.#toWorkspacePath(abs)
          const unsaved = this.deps.editor.unsaved(rel)
          if (unsaved !== undefined) return sliceLines(unsaved, line, limit)
          const file = await this.deps.workspace.readFile(rel)
          if (file.binary) throw RequestError.invalidParams(undefined, `${abs} is a binary file`)
          if (file.tooLarge) throw RequestError.invalidParams(undefined, `${abs} is too large to read`)
          return sliceLines(file.contents, line, limit)
        },
        writeTextFile: async ({ path: abs, content }) => {
          // Written straight to disk so the agent's own builds and tests see it; the user
          // reviews it afterwards against the baseline (see ReviewService).
          const rel = await this.#toWorkspacePath(abs)
          const before = await this.deps.workspace.readText(rel)
          await this.deps.workspace.writeFile(rel, content)
          await this.deps.review?.recordAgentWrite(rel, before)
          this.deps.onAgentWrite?.(rel)
        },
        terminal: {
          create: async (params) => {
            const terminals = this.#requireTerminals()
            const root = this.deps.workspace.root!
            const cwd = params.cwd ? path.join(root, await this.#toWorkspacePath(params.cwd)) : root
            return terminals.create(params, cwd, definition.label)
          },
          output: (id) => this.#requireTerminals().output(id),
          waitForExit: (id) => this.#requireTerminals().waitForExit(id),
          kill: (id) => this.#requireTerminals().kill(id),
          release: (id) => this.#requireTerminals().release(id),
        },
        requestPermission: (params) => this.deps.permissions.request(params),
        onSessionUpdate: (notification) => this.deps.onSessionUpdate(notification),
        onExit: (error) => {
          if (this.#running.get(agentId)?.client !== client) return
          this.#running.delete(agentId)
          for (const [sessionId, owner] of this.#sessions)
            if (owner === agentId) this.#sessions.delete(sessionId)
          this.#setStatus(agentId, error ? { state: 'error', message: error.message } : { state: 'stopped' })
        },
      },
    )

    this.#setStatus(agentId, { state: 'starting' })
    const ready = client.start().then(
      (init) => {
        this.#setStatus(agentId, {
          state: 'ready',
          ...(init.agentInfo?.title || init.agentInfo?.name
            ? { agentName: init.agentInfo.title ?? init.agentInfo.name }
            : {}),
          ...(init.agentInfo?.version ? { agentVersion: init.agentInfo.version } : {}),
        })
      },
      (error: unknown) => {
        this.#running.delete(agentId)
        client.dispose()
        const message =
          `${error instanceof Error ? error.message : String(error)}\n${client.stderrTail}`.trim()
        this.#setStatus(agentId, { state: 'error', message })
        throw new Error(message)
      },
    )
    const running = { client, ready }
    this.#running.set(agentId, running)
    await ready
    return running
  }

  /** ACP paths are absolute; map them into the workspace or refuse. */
  async #toWorkspacePath(abs: string): Promise<string> {
    const root = this.deps.workspace.root
    if (!root) throw RequestError.invalidParams(undefined, 'No workspace open')
    if (!path.isAbsolute(abs)) throw RequestError.invalidParams(undefined, `Path must be absolute: ${abs}`)

    const inside = (p: string): string | null => {
      const rel = path.relative(root, p)
      return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/')
    }
    const direct = inside(path.resolve(abs))
    if (direct !== null) return direct

    // The agent may use a different spelling of the same folder (/tmp vs /private/tmp).
    let probe = path.resolve(abs)
    const rest: string[] = []
    for (;;) {
      try {
        const real = path.join(await fs.realpath(probe), ...rest)
        const viaReal = inside(real)
        if (viaReal !== null) return viaReal
        break
      } catch {
        const parent = path.dirname(probe)
        if (parent === probe) break
        rest.unshift(path.basename(probe))
        probe = parent
      }
    }
    throw RequestError.invalidParams(undefined, `Path is outside the workspace: ${abs}`)
  }

  #setStatus(agentId: string, status: AgentStatus): void {
    this.#status.set(agentId, status)
    this.deps.onStatus(agentId, status)
  }
}

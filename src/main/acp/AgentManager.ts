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
} from '../../shared/agent'
import type { EditorState } from '../editor/EditorState'
import type { EditorMcpHandle } from '../mcp/editorMcpServer'
import type { PermissionService } from '../permissions/PermissionService'
import type { ReviewService } from '../review/ReviewService'
import type { AgentTerminals } from '../terminal/AgentTerminals'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import { AcpClient } from './AcpClient'
import { summarize, type AgentDefinition } from './definition'

export interface AgentManagerDeps {
  definitions(): Promise<AgentDefinition[]>
  workspace: WorkspaceService
  editor: EditorState
  permissions: PermissionService
  mcp(): EditorMcpHandle | null
  onStatus(agentId: string, status: AgentStatus): void
  onSessionUpdate(notification: SessionNotification): void
  /** Optional so tests can run without them. */
  review?: Pick<ReviewService, 'beginTurn' | 'endTurn' | 'recordAgentWrite'>
  terminals?: AgentTerminals
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

interface RunningAgent {
  client: AcpClient
  ready: Promise<void>
}

/**
 * Owns agent processes (one per agent, shared by all its sessions) and routes
 * sessions to them. Agents are started lazily and restarted on next use after
 * they exit. All file access from agents goes through the WorkspaceService.
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
    const root = this.deps.workspace.root
    if (!root) throw new Error('Open a folder before starting an agent session.')
    const agent = await this.#ensure(agentId)
    try {
      const response = await agent.client.newSession(root, this.#mcpServers(agent.client))
      this.#sessions.set(response.sessionId, agentId)
      return {
        sessionId: response.sessionId,
        agentId,
        modes: response.modes ?? null,
        promptCapabilities: agent.client.initializeResponse?.agentCapabilities?.promptCapabilities ?? {},
      }
    } catch (error) {
      if (error instanceof RequestError && error.code === AUTH_REQUIRED_CODE) {
        return {
          authRequired: true,
          agentId,
          methods: agent.client.initializeResponse?.authMethods ?? [],
          message: error.message,
        }
      }
      throw error
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

  #requireTerminals(): AgentTerminals {
    if (!this.deps.terminals) throw RequestError.methodNotFound('terminal/create')
    return this.deps.terminals
  }

  #clientFor(sessionId: string): AcpClient {
    const agentId = this.#sessions.get(sessionId)
    const agent = agentId ? this.#running.get(agentId) : undefined
    if (!agent) throw new Error('This session has ended. Start a new chat.')
    return agent.client
  }

  #mcpServers(client: AcpClient): McpServer[] {
    const mcp = this.deps.mcp()
    const supportsHttp = client.initializeResponse?.agentCapabilities?.mcpCapabilities?.http
    if (!mcp || !supportsHttp) return []
    return [{ type: 'http', name: 'lookingglass', url: mcp.url, headers: mcp.headers }]
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

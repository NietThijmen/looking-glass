import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ContentBlock,
  type CreateTerminalRequest,
  type InitializeResponse,
  type ListSessionsResponse,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type ReadTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalExitStatus,
  type TerminalOutputResponse,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk'
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { childEnv } from './childEnv'

export interface AgentProcessSpec {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd: string
}

/** What the client needs from the rest of the app. */
export interface AcpClientHost {
  readTextFile(params: ReadTextFileRequest): Promise<string>
  writeTextFile(params: WriteTextFileRequest): Promise<void>
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
  onSessionUpdate(notification: SessionNotification): void
  onExit(error: Error | null): void
  terminal: {
    create(params: CreateTerminalRequest): Promise<string>
    output(terminalId: string): TerminalOutputResponse
    waitForExit(terminalId: string): Promise<TerminalExitStatus>
    kill(terminalId: string): void
    release(terminalId: string): void
  }
}

const STDERR_LINES = 200

/**
 * One agent subprocess speaking ACP over stdio. Implements the client side of
 * the protocol by delegating to `host`.
 */
export class AcpClient {
  #child: ChildProcess | null = null
  #connection: ClientConnection | null = null
  #stderr: string[] = []
  #exited = false
  initializeResponse: InitializeResponse | null = null

  constructor(
    private readonly spec: AgentProcessSpec,
    private readonly host: AcpClientHost,
  ) {}

  get stderrTail(): string {
    return this.#stderr.join('\n')
  }

  async start(): Promise<InitializeResponse> {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: childEnv(this.spec.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child

    let partial = ''
    child.stderr!.on('data', (chunk: Buffer) => {
      const lines = (partial + chunk.toString()).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) {
        this.#stderr.push(line)
        if (this.#stderr.length > STDERR_LINES) this.#stderr.shift()
      }
    })

    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.once('exit', (code, signal) => {
      this.#exited = true
      this.#connection?.close()
      const clean = code === 0 || signal === 'SIGTERM'
      this.host.onExit(
        clean ? null : new Error(`Agent exited (${signal ?? code})\n${this.stderrTail}`.trim()),
      )
    })
    await spawned

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    )

    this.#connection = client({ name: 'lookingglass' })
      .onNotification(methods.client.session.update, (ctx) => this.host.onSessionUpdate(ctx.params))
      .onRequest(methods.client.session.requestPermission, (ctx) => this.host.requestPermission(ctx.params))
      .onRequest(methods.client.terminal.create, async (ctx) => ({
        terminalId: await this.host.terminal.create(ctx.params),
      }))
      .onRequest(methods.client.terminal.output, (ctx) => this.host.terminal.output(ctx.params.terminalId))
      .onRequest(methods.client.terminal.waitForExit, (ctx) =>
        this.host.terminal.waitForExit(ctx.params.terminalId),
      )
      .onRequest(methods.client.terminal.kill, (ctx) => {
        this.host.terminal.kill(ctx.params.terminalId)
        return {}
      })
      .onRequest(methods.client.terminal.release, (ctx) => {
        this.host.terminal.release(ctx.params.terminalId)
        return {}
      })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => ({
        content: await this.host.readTextFile(ctx.params),
      }))
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        await this.host.writeTextFile(ctx.params)
        return {}
      })
      .connect(stream)

    this.initializeResponse = await this.#agent().request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'lookingglass', title: 'Lookingglass', version: '0.0.1' },
    })
    return this.initializeResponse
  }

  authenticate(methodId: string): Promise<unknown> {
    return this.#agent().request(methods.agent.authenticate, { methodId })
  }

  newSession(cwd: string, mcpServers: McpServer[]): Promise<NewSessionResponse> {
    return this.#agent().request(methods.agent.session.new, { cwd, mcpServers })
  }

  listSessions(cwd: string, cursor?: string): Promise<ListSessionsResponse> {
    return this.#agent().request(methods.agent.session.list, { cwd, ...(cursor ? { cursor } : {}) })
  }

  /** The agent replays the session's history as `session/update` notifications before it answers. */
  loadSession(sessionId: string, cwd: string, mcpServers: McpServer[]): Promise<LoadSessionResponse> {
    return this.#agent().request(methods.agent.session.load, { sessionId, cwd, mcpServers })
  }

  prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse> {
    return this.#agent().request(methods.agent.session.prompt, { sessionId, prompt })
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#agent().notify(methods.agent.session.cancel, { sessionId })
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.#agent().request(methods.agent.session.setMode, { sessionId, modeId })
  }

  dispose(): void {
    this.#connection?.close()
    if (this.#child && !this.#exited) this.#child.kill('SIGTERM')
  }

  #agent() {
    if (!this.#connection || this.#exited) throw new Error('Agent is not running')
    return this.#connection.agent
  }
}

import { spawn, type ChildProcess } from 'node:child_process'
import { childEnv } from '@lookingglass/acp/childEnv'

export interface LspProcessSpec {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd: string
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void }

const STDERR_LINES = 100

/**
 * A minimal Language Server Protocol client over stdio: Content-Length framed
 * JSON-RPC, requests, notifications, and stock answers to the few requests a
 * server sends us.
 */
export class LspClient {
  #child: ChildProcess | null = null
  #nextId = 1
  #pending = new Map<number, Pending>()
  #buffer = Buffer.alloc(0)
  #handlers = new Map<string, (params: unknown) => void>()
  #stderr: string[] = []
  #exited = false

  constructor(
    private readonly spec: LspProcessSpec,
    private readonly onExit: (error: Error | null) => void,
  ) {}

  get stderrTail(): string {
    return this.#stderr.join('\n')
  }

  async start(): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: childEnv(this.spec.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    child.stdout!.on('data', (chunk: Buffer) => this.#read(chunk))
    child.stderr!.on('data', (chunk: Buffer) => {
      this.#stderr.push(...chunk.toString().split('\n').filter(Boolean))
      if (this.#stderr.length > STDERR_LINES) this.#stderr.splice(0, this.#stderr.length - STDERR_LINES)
    })
    child.once('exit', (code, signal) => {
      this.#exited = true
      const error = new Error(`Language server exited (${signal ?? code})\n${this.stderrTail}`.trim())
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
      this.onExit(code === 0 || signal === 'SIGTERM' ? null : error)
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.#handlers.set(method, handler)
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.#send({ jsonrpc: '2.0', method, params })
  }

  async shutdown(): Promise<void> {
    if (!this.#child || this.#exited) return
    try {
      await Promise.race([this.request('shutdown', null), new Promise((r) => setTimeout(r, 1000))])
      this.notify('exit', null)
    } catch {
      // Already gone.
    }
    if (!this.#exited) this.#child.kill('SIGTERM')
  }

  #send(message: object): void {
    if (!this.#child || this.#exited) throw new Error('Language server is not running')
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    this.#child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.#child.stdin!.write(body)
  }

  #read(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    for (;;) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.#buffer.subarray(0, headerEnd).toString('ascii')
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1])
      if (!Number.isFinite(length)) {
        // Unframed noise; drop the header and resync.
        this.#buffer = this.#buffer.subarray(headerEnd + 4)
        continue
      }
      const start = headerEnd + 4
      if (this.#buffer.length < start + length) return
      const body = this.#buffer.subarray(start, start + length).toString('utf8')
      this.#buffer = this.#buffer.subarray(start + length)
      try {
        this.#dispatch(JSON.parse(body) as Record<string, unknown>)
      } catch (error) {
        console.error('[lsp] bad message', error)
      }
    }
  }

  #dispatch(message: Record<string, unknown>): void {
    const { id, method } = message
    if (typeof method === 'string' && id !== undefined) {
      // Requests from the server: answer what we can with defaults.
      const result = method === 'workspace/configuration' ? configurationDefaults(message['params']) : null
      this.#send({ jsonrpc: '2.0', id, result })
      return
    }
    if (typeof method === 'string') {
      this.#handlers.get(method)?.(message['params'])
      return
    }
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined
    if (!pending) return
    this.#pending.delete(id as number)
    const error = message['error'] as { message?: string } | undefined
    if (error) pending.reject(new Error(error.message ?? 'Language server error'))
    else pending.resolve(message['result'])
  }
}

function configurationDefaults(params: unknown): unknown[] {
  const items = (params as { items?: unknown[] } | undefined)?.items ?? []
  return items.map(() => null)
}

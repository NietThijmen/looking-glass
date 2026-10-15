import type {
  CreateTerminalRequest,
  TerminalExitStatus,
  TerminalOutputResponse,
} from '@agentclientprotocol/sdk'
import type { TerminalInfo } from '@lookingglass/shared/ipc'
import type { TerminalService } from './TerminalService'
import { loginShellPath, mergePaths } from './shellPath'

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024

interface AgentTerminal {
  sessionId: string
  output: string
  truncated: boolean
  limit: number
  exit: TerminalExitStatus | null
  waiters: Array<(status: TerminalExitStatus) => void>
}

// CSI/OSC sequences and other escapes; agents want plain text, the panel keeps the colours.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

export function plainText(data: string): string {
  return data.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '')
}

/** Keep the last `limit` bytes of `text`, cut on a character boundary. */
export function keepTail(text: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= limit) return { text, truncated: false }
  let start = bytes.length - limit
  // Skip UTF-8 continuation bytes so we don't start mid-character.
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++
  return { text: bytes.subarray(start).toString('utf8'), truncated: true }
}

/**
 * ACP `terminal/*` for agents. Commands run in real ptys owned by the
 * TerminalService, so they show up in the terminal panel (and can be watched or
 * killed by the user) while the agent reads plain-text output.
 */
export class AgentTerminals {
  #terminals = new Map<string, AgentTerminal>()

  constructor(
    private readonly terminals: TerminalService,
    private readonly opened: (info: TerminalInfo) => void,
  ) {}

  async create(params: CreateTerminalRequest, cwd: string, agentLabel: string): Promise<string> {
    const shell = process.env['SHELL'] ?? '/bin/sh'
    const args = params.args ?? []
    // No args: treat `command` as a shell command line, which is how most agents send it.
    // With args, still go through the login shell (`exec`) so `command` is found on the user's PATH.
    const command =
      args.length === 0
        ? { file: shell, args: ['-lc', params.command] }
        : { file: shell, args: ['-lc', 'exec "$0" "$@"', params.command, ...args] }
    const env = Object.fromEntries((params.env ?? []).map((v) => [v.name, v.value]))
    // The agent's own PATH override wins; otherwise give it the user's shell PATH.
    const path = mergePaths(await loginShellPath(), process.env['PATH'])
    if (path && !('PATH' in env)) env['PATH'] = path
    const title = `${agentLabel}: ${[params.command, ...args].join(' ').slice(0, 40)}`

    const info = this.terminals.create(cwd, { cols: 120, rows: 30 }, { ...command, env, title })
    const terminal: AgentTerminal = {
      sessionId: params.sessionId,
      output: '',
      truncated: false,
      limit: params.outputByteLimit ?? DEFAULT_OUTPUT_LIMIT,
      exit: null,
      waiters: [],
    }
    this.#terminals.set(info.id, terminal)
    this.terminals.observe(info.id, {
      onData: (_id, data) => {
        const next = keepTail(terminal.output + plainText(data), terminal.limit)
        terminal.output = next.text
        terminal.truncated ||= next.truncated
      },
      onExit: (_id, exitCode) => {
        terminal.exit = { exitCode, signal: null }
        for (const resolve of terminal.waiters.splice(0)) resolve(terminal.exit)
      },
    })
    this.opened(info)
    return info.id
  }

  output(terminalId: string): TerminalOutputResponse {
    const terminal = this.#get(terminalId)
    return { output: terminal.output, truncated: terminal.truncated, exitStatus: terminal.exit }
  }

  waitForExit(terminalId: string): Promise<TerminalExitStatus> {
    const terminal = this.#get(terminalId)
    if (terminal.exit) return Promise.resolve(terminal.exit)
    return new Promise((resolve) => terminal.waiters.push(resolve))
  }

  kill(terminalId: string): void {
    this.#get(terminalId)
    this.terminals.kill(terminalId)
  }

  /** The agent is done with it: stop the command if still running and forget the output. */
  release(terminalId: string): void {
    if (!this.#terminals.has(terminalId)) return
    this.terminals.kill(terminalId)
    this.#terminals.delete(terminalId)
  }

  releaseSession(sessionId: string): void {
    for (const [id, terminal] of this.#terminals) if (terminal.sessionId === sessionId) this.release(id)
  }

  releaseAll(): void {
    for (const id of [...this.#terminals.keys()]) this.release(id)
  }

  #get(terminalId: string): AgentTerminal {
    const terminal = this.#terminals.get(terminalId)
    if (!terminal) throw new Error(`Unknown terminal: ${terminalId}`)
    return terminal
  }
}

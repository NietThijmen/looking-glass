import os from 'node:os'
import path from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { TerminalCreateOptions, TerminalInfo } from '../../shared/ipc'
import { childEnv } from '../childEnv'

const FLUSH_MS = 8

export interface TerminalHandlers {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number): void
}

interface Session {
  pty: IPty
  buffer: string
  timer: NodeJS.Timeout | undefined
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: process.env['COMSPEC'] ?? 'powershell.exe', args: [] }
  const file = process.env['SHELL'] ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // A login shell picks up the user's PATH even when the app was launched from Finder/Dock.
  return { file, args: ['-l'] }
}

/**
 * PTY sessions shared by the user and (from Phase 3) agents. Output is
 * coalesced per session so a chatty process doesn't flood IPC.
 */
export class TerminalService {
  #sessions = new Map<string, Session>()
  #observers = new Map<string, TerminalHandlers>()
  #nextId = 1

  constructor(private readonly handlers: TerminalHandlers) {}

  /** Start a terminal running the user's shell, or `command` when given (e.g. an agent's login flow). */
  create(
    cwd: string | null,
    options: TerminalCreateOptions,
    command?: { file: string; args: string[]; env?: Record<string, string>; title: string },
  ): TerminalInfo {
    const id = `t${this.#nextId++}`
    const shell = command ?? defaultShell()
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, Math.floor(options.cols)),
      rows: Math.max(1, Math.floor(options.rows)),
      cwd: cwd ?? os.homedir(),
      env: childEnv({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'Lookingglass',
        ...command?.env,
      }),
    })

    const session: Session = { pty, buffer: '', timer: undefined }
    this.#sessions.set(id, session)

    pty.onData((data) => {
      session.buffer += data
      session.timer ??= setTimeout(() => this.#flush(id), FLUSH_MS)
    })
    pty.onExit(({ exitCode }) => {
      this.#flush(id)
      this.#sessions.delete(id)
      this.handlers.onExit(id, exitCode)
      this.#observers.get(id)?.onExit(id, exitCode)
      this.#observers.delete(id)
    })

    return { id, title: command?.title ?? path.basename(shell.file) }
  }

  /** Extra listener for one terminal's output and exit (used for agent terminals). */
  observe(id: string, observer: TerminalHandlers): void {
    this.#observers.set(id, observer)
  }

  isRunning(id: string): boolean {
    return this.#sessions.has(id)
  }

  write(id: string, data: string): void {
    this.#sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.#sessions.get(id)
    if (!session || cols < 2 || rows < 1) return
    try {
      session.pty.resize(Math.floor(cols), Math.floor(rows))
    } catch {
      // The pty may have exited between the check and the call.
    }
  }

  kill(id: string): void {
    const session = this.#sessions.get(id)
    if (!session) return
    clearTimeout(session.timer)
    this.#sessions.delete(id)
    session.pty.kill()
  }

  killAll(): void {
    for (const id of [...this.#sessions.keys()]) this.kill(id)
  }

  #flush(id: string): void {
    const session = this.#sessions.get(id)
    if (!session) return
    clearTimeout(session.timer)
    session.timer = undefined
    if (!session.buffer) return
    const data = session.buffer
    session.buffer = ''
    this.handlers.onData(id, data)
    this.#observers.get(id)?.onData(id, data)
  }
}

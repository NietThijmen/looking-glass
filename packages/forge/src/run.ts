import { execFile } from 'node:child_process'

const MAX_BUFFER = 64 * 1024 * 1024

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/** Shell-out used by a forge. Tests pass a fake; the app passes `runCommand`. */
export type CommandRun = (command: string, args: string[], cwd: string) => Promise<CommandResult>

/**
 * Run a command without a shell. A missing binary or a non-zero exit becomes a result,
 * never a throw, so a missing `gh` login is "no pull request" rather than an error.
 * No GitHub token is added; `gh` uses the login already on the machine.
 */
export function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      },
      (error, stdout, stderr) => {
        const raw = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
        const code = typeof raw === 'number' ? raw : error ? 127 : 0
        resolve({
          code,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        })
      },
    )
  })
}

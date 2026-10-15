import { spawn } from 'node:child_process'

const COMMAND_TIMEOUT_MS = 5000

/**
 * A GitHub token for api.github.com: `GH_TOKEN` or `GITHUB_TOKEN` first, then the GitHub CLI's
 * login (`gh auth token`), then whatever credential helper git is set up with. Null when none
 * has one.
 */
export async function resolveGithubToken(cwd: string): Promise<string | null> {
  const fromEnv = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return (await ghCliToken(cwd)) ?? credentialHelperToken(cwd)
}

async function ghCliToken(cwd: string): Promise<string | null> {
  const stdout = await run('gh', ['auth', 'token', '--hostname', 'github.com'], cwd)
  return stdout?.trim() || null
}

async function credentialHelperToken(cwd: string): Promise<string | null> {
  const stdout = await run('git', ['credential', 'fill'], cwd, 'protocol=https\nhost=github.com\n\n')
  return (stdout && /^password=(.+)$/m.exec(stdout)?.[1]?.trim()) || null
}

/** Stdout of a command that exits 0 within the timeout, else null (including when it is not installed). */
function run(command: string, args: string[], cwd: string, input?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? stdout : null)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

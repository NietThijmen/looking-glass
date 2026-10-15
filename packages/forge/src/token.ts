import { spawn } from 'node:child_process'

const CREDENTIAL_TIMEOUT_MS = 5000

/**
 * A GitHub token for api.github.com: `GH_TOKEN` or `GITHUB_TOKEN` first, then whatever
 * credential helper git is set up with. Null when neither has one.
 */
export async function resolveGithubToken(cwd: string): Promise<string | null> {
  const fromEnv = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()
  if (fromEnv) return fromEnv
  return credentialHelperToken(cwd)
}

function credentialHelperToken(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['credential', 'fill'], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), CREDENTIAL_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      const password = /^password=(.+)$/m.exec(stdout)?.[1]?.trim()
      resolve(password || null)
    })
    child.stdin.on('error', () => {})
    child.stdin.end('protocol=https\nhost=github.com\n\n')
  })
}

/**
 * Variables that steer Electron or electron-vite itself. They must not leak into
 * processes we start: an agent's shell inheriting `ELECTRON_RUN_AS_NODE=1` turns
 * every Electron app it launches (including `pnpm dev` / `pnpm smoke` of an
 * Electron project) into plain Node.
 */
const ELECTRON_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_EXEC_PATH',
  'ELECTRON_CLI_ARGS',
  'ELECTRON_MAJOR_VER',
  'NODE_ENV_ELECTRON_VITE',
]

/** `process.env` without Electron's own variables, plus `extra`. */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !ELECTRON_VARS.includes(key)) env[key] = value
  }
  return { ...env, ...extra }
}

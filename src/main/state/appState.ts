import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Small persisted app state in userData. Not for anything large or secret. */
export interface AppState {
  lastWorkspace?: string
  /** Folders opened before, most recent first. */
  recentWorkspaces?: string[]
  /** Workspace root → hash of the MCP server list the user allowed for it. */
  trustedMcpServers?: Record<string, string>
}

const file = (): string => path.join(app.getPath('userData'), 'state.json')

export async function loadAppState(): Promise<AppState> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as AppState
  } catch {
    return {}
  }
}

export async function saveAppState(patch: Partial<AppState>): Promise<void> {
  const next = { ...(await loadAppState()), ...patch }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(next, null, 2))
}

import { BrowserWindow, clipboard, dialog } from 'electron'
import type { FsChange, WorkspaceInfo } from '@lookingglass/shared/ipc'
import { isSmokeTest } from '../env'
import { saveAppState } from '../state/appState'
import { TerminalService } from '../terminal/TerminalService'
import { forgeFor, parseRemote, runCommand, type Forge, type PullRequestQuery } from '@lookingglass/forge'
import {
  GitService,
  listFiles,
  SearchService,
  watchWorkspace,
  WorkspaceService,
} from '@lookingglass/workspace'
import { broadcast } from './broadcast'
import { handle } from './typed'

export const workspace = new WorkspaceService()
export const git = new GitService()
const search = new SearchService()
export const terminals = new TerminalService({
  onData: (id, data) => broadcast('terminal:data', { id, data }),
  onExit: (id, exitCode) => broadcast('terminal:exit', { id, exitCode }),
})

let stopWatching: (() => Promise<void>) | null = null
const changeListeners: Array<() => void> = []
const fsListeners: Array<(changes: FsChange[]) => void> = []

/** Called with batched file changes in the open workspace. */
export function onWorkspaceFsChange(listener: (changes: FsChange[]) => void): void {
  fsListeners.push(listener)
}

/** Called before a different workspace opens or the current one closes. */
export function onWorkspaceWillChange(listener: () => void): void {
  changeListeners.push(listener)
}

export async function openWorkspace(root: string): Promise<WorkspaceInfo> {
  for (const listener of changeListeners) listener()
  const info = await workspace.open(root)
  await stopWatching?.()
  stopWatching = null
  try {
    stopWatching = await watchWorkspace(info.root, {
      onFsChange: (changes) => {
        broadcast('fs:changed', changes)
        for (const listener of fsListeners) listener(changes)
      },
      onGitChange: () => broadcast('git:changed', null),
    })
  } catch (error) {
    // Live updates are a nicety; the workspace still works without them.
    console.error('[workspace] watcher failed', error)
  }
  search.cancel()
  // Smoke runs open throwaway fixtures; don't make them the user's "last workspace".
  if (!isSmokeTest) await saveAppState({ lastWorkspace: info.root })
  broadcast('workspace:changed', info)
  return info
}

export async function closeWorkspace(): Promise<void> {
  for (const listener of changeListeners) listener()
  await stopWatching?.()
  stopWatching = null
  search.cancel()
  terminals.killAll()
  workspace.close()
}

function requireRoot(): string {
  const root = workspace.root
  if (!root) throw new Error('No workspace open')
  return root
}

export function registerWorkspaceHandlers(): void {
  handle('clipboard:readText', () => clipboard.readText())

  handle('workspace:get', () => workspace.info)
  handle('workspace:openDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] } satisfies Electron.OpenDialogOptions
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    return openWorkspace(picked)
  })

  handle('fs:readDir', (_e, path) => workspace.readDir(path))
  handle('fs:readFile', (_e, path) => workspace.readFile(path))
  handle('fs:writeFile', (_e, path, contents) => workspace.writeFile(path, contents))
  handle('fs:listFiles', () => listFiles(requireRoot()))
  handle('git:diff', () => git.diff(requireRoot()))

  handle('search:run', (_e, query) => search.run(requireRoot(), query))

  handle('git:status', () => (workspace.root ? git.status(workspace.root) : null))
  handle('git:headContents', async (_e, path) => {
    await workspace.resolve(path)
    return git.headContents(requireRoot(), path)
  })
  handle('git:log', (_e, limit) => (workspace.root ? git.log(workspace.root, limit ?? 50) : []))
  handle('git:commit', async (_e, message) => {
    const result = await git.commit(requireRoot(), message)
    if (result.ok) broadcast('git:changed', null)
    return result
  })
  handle('git:push', async () => {
    const result = await git.push(requireRoot())
    if (result.ok) broadcast('git:changed', null)
    return result
  })
  // Separate from status so chat typing never waits on `gh`.
  handle('git:pullRequest', async () => {
    const target = await forgeTarget()
    return target ? target.forge.pullRequest(target.query) : null
  })
  handle('git:pullRequestAction', async (_e, number, action) => {
    const target = await forgeTarget()
    if (!target) return { ok: false, error: 'No forge for this branch.' }
    return target.forge.act(target.query, number, action)
  })

  handle('terminal:create', (_e, options) => terminals.create(workspace.root, options))
  handle('terminal:write', (_e, id, data) => terminals.write(id, data))
  handle('terminal:resize', (_e, id, cols, rows) => terminals.resize(id, cols, rows))
  handle('terminal:kill', (_e, id) => terminals.kill(id))
}

/** The forge and query for the current branch's upstream, or null when there is none. */
async function forgeTarget(): Promise<{ forge: Forge; query: PullRequestQuery } | null> {
  const root = workspace.root
  if (!root) return null
  const upstream = await git.upstream(root)
  if (!upstream) return null
  const remote = parseRemote(upstream.url)
  if (!remote) return null
  const forge = forgeFor(remote)
  if (!forge) return null
  return { forge, query: { cwd: root, remote, branch: upstream.branch, run: runCommand } }
}

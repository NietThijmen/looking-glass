import { EditProvider } from '@pierre/diffs/react'
import { useEffect, useState } from 'react'
import type { AppInfo, MenuCommand, WindowState } from '../../shared/ipc'
import { AgentPanel } from './agent/AgentPanel'
import { createEditor } from './editor/diffsConfig'
import { EditorArea } from './editor/EditorArea'
import { publishEditorSnapshots } from './editor/publishSnapshot'
import { ActivityBar, Sidebar } from './layout/Sidebar'
import { useAgents } from './store/agents'
import { useEditor } from './store/editor'
import { useUi } from './store/ui'
import { useWorkspace } from './store/workspace'
import { TerminalPanel } from './terminal/TerminalPanel'

function runMenuCommand(command: MenuCommand): void {
  const editor = useEditor.getState()
  const ui = useUi.getState()
  switch (command) {
    case 'open-folder':
      void window.lookingglass.workspace.openDialog()
      break
    case 'save':
      void editor.save()
      break
    case 'close-tab':
      if (editor.activeId) editor.closeTab(editor.activeId)
      break
    case 'toggle-terminal':
      ui.toggleTerminal()
      break
    case 'show-explorer':
      ui.showSidebar('explorer')
      break
    case 'show-search':
      ui.showSidebar('search')
      break
    case 'show-git':
      ui.showSidebar('git')
      break
  }
}

function useBoot(): boolean {
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    const api = window.lookingglass
    const workspace = useWorkspace.getState()

    const unsubs = [
      api.app.onMenuCommand(runMenuCommand),
      api.workspace.onChanged((info) => {
        useEditor.getState().reset()
        // Agents are bound to the old folder and have been stopped by main.
        useAgents.getState().reset()
        void useWorkspace.getState().setWorkspace(info)
      }),
      api.fs.onChanged((changes) => {
        useWorkspace.getState().applyFsChanges(changes)
        useEditor.getState().applyFsChanges(changes)
      }),
      api.git.onChanged(() => void useWorkspace.getState().refreshGit()),
      api.editor.onOpenFile(({ path, line }) => {
        void useEditor.getState().openFile(path, line ? { line, column: 0 } : undefined)
      }),
      api.agent.onUpdate(({ sessionId, update }) => useAgents.getState().applyUpdate(sessionId, update)),
      api.agent.onStatus(({ agentId, status }) => useAgents.getState().setStatus(agentId, status)),
      api.agent.onPermission((request) => useAgents.getState().addPermission(request)),
      api.agent.onPermissionResolved(({ requestId }) => useAgents.getState().removePermission(requestId)),
      publishEditorSnapshots(),
    ]
    void useAgents.getState().loadAgents()
    void api.workspace
      .get()
      .then((info) => workspace.setWorkspace(info))
      .finally(() => setBooted(true))
    return () => unsubs.forEach((u) => u())
  }, [])
  return booted
}

export function App() {
  const booted = useBoot()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [windowState, setWindowState] = useState<WindowState | null>(null)
  const workspace = useWorkspace((s) => s.info)
  const branch = useWorkspace((s) => s.git?.branch)
  const terminalOpen = useUi((s) => s.terminalOpen)

  useEffect(() => {
    void window.lookingglass.app.getInfo().then(setInfo)
    void window.lookingglass.window.getState().then(setWindowState)
    return window.lookingglass.window.onState(setWindowState)
  }, [])

  const inset = info?.platform === 'darwin' && !windowState?.fullscreen

  return (
    <EditProvider createEditor={createEditor}>
      <div data-testid="app-shell" className="flex h-full flex-col">
        <header
          className={`drag flex h-9 shrink-0 items-center border-b border-border bg-panel pr-3 ${inset ? 'pl-20' : 'pl-3'} ${
            windowState?.focused === false ? 'opacity-60' : ''
          }`}
        >
          <span className="font-medium">Lookingglass</span>
          <span className="ml-2 truncate text-muted">{workspace ? workspace.root : 'no folder open'}</span>
        </header>

        {booted && (
          <div className="flex min-h-0 flex-1">
            <ActivityBar />
            <Sidebar />
            <main className="flex min-w-0 flex-1 flex-col">
              <section className="min-h-0 flex-1 bg-bg">
                <EditorArea />
              </section>
              <section
                className={`h-64 shrink-0 border-t border-border bg-bg ${terminalOpen ? '' : 'hidden'}`}
                aria-hidden={!terminalOpen}
              >
                <TerminalPanel />
              </section>
            </main>
            <AgentPanel />
          </div>
        )}

        <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 font-mono text-[11px] text-muted">
          {branch && <span>⑂ {branch}</span>}
          <span className="ml-auto" />
          {info && (
            <>
              <span>v{info.version}</span>
              <span>Electron {info.versions.electron}</span>
            </>
          )}
        </footer>
      </div>
    </EditProvider>
  )
}

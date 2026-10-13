import { EditProvider } from '@pierre/diffs/react'
import { openInlineEdit } from './agent/inlineEdit'
import { GitBranch, Icon, iconSize } from './ui/icon'
import { useEffect, useState } from 'react'
import type { AppInfo, MenuCommand, WindowState } from '../../shared/ipc'
import { createEditor } from './editor/diffsConfig'
import { openBrowserTab } from './editor/EditorArea'
import { publishEditorSnapshots } from './editor/publishSnapshot'
import { ResizeHandle } from './layout/ResizeHandle'
import { ActivityBar, Sidebar } from './layout/Sidebar'
import { Workbench } from './layout/Workbench'
import { useAgents } from './store/agents'
import { useBrowser } from './store/browser'
import { useEditor } from './store/editor'
import { useDiagnostics } from './store/diagnostics'
import { useSettings } from './store/settings'
import { useReview } from './store/review'
import { useUi } from './store/ui'
import { useWorkspace } from './store/workspace'

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
    case 'toggle-sidebar':
      ui.toggleSidebar()
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
    case 'show-commits':
      ui.showSidebar('commits')
      break
    case 'new-browser-tab':
      openBrowserTab()
      break
    case 'inline-edit':
      openInlineEdit()
      break
    case 'open-settings':
      editor.openSettings()
      break
    case 'toggle-picker': {
      const tab = editor.tabs.find((t) => t.id === editor.activeId)
      const tabId = tab?.kind === 'browser' ? tab.path : useBrowser.getState().lastTabId
      if (!tabId) break
      if (tab?.kind !== 'browser') editor.adoptBrowser(tabId)
      void window.lookingglass.browser.setPicking(tabId, !useBrowser.getState().tabs[tabId]?.picking)
      break
    }
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
        useBrowser.getState().reset()
        useDiagnostics.getState().reset()
        void useReview.getState().load()
        void useWorkspace.getState().setWorkspace(info)
      }),
      api.fs.onChanged((changes) => {
        useWorkspace.getState().applyFsChanges(changes)
        useEditor.getState().applyFsChanges(changes)
      }),
      api.git.onChanged(() => void useWorkspace.getState().refreshGit()),
      api.review.onChanged((entries) => useReview.getState().set(entries)),
      api.diagnostics.onChanged(({ path, diagnostics }) => useDiagnostics.getState().set(path, diagnostics)),
      api.browser.onState((state) => useBrowser.getState().setState(state)),
      api.browser.onConsole(({ tabId, entry }) => useBrowser.getState().addConsole(tabId, entry)),
      api.browser.onPicked(({ item, mode }) => useBrowser.getState().applyPick(item, mode)),
      api.browser.onOpened((state) => {
        useBrowser.getState().setState(state)
        useEditor.getState().adoptBrowser(state.tabId)
      }),
      api.fs.onChanged((changes) => useReview.getState().touch(changes.map((c) => c.path))),
      api.editor.onReloadFile(({ path }) => {
        if (useEditor.getState().buffers[path]) void useEditor.getState().reloadFromDisk(path)
      }),
      api.editor.onOpenFile(({ path, line }) => {
        void useEditor.getState().openFile(path, line ? { line, column: 0 } : undefined)
      }),
      api.agent.onUpdate(({ sessionId, update }) => useAgents.getState().applyUpdate(sessionId, update)),
      api.agent.onStatus(({ agentId, status }) => useAgents.getState().setStatus(agentId, status)),
      api.agent.onPermission((request) => useAgents.getState().addPermission(request)),
      api.agent.onPermissionResolved(({ requestId }) => useAgents.getState().removePermission(requestId)),
      api.settings.onChanged((settings) => useSettings.getState().apply(settings)),
      api.settings.onAgentsChanged(() => void useAgents.getState().loadAgents()),
      publishEditorSnapshots(),
    ]
    void useAgents.getState().loadAgents()
    void useSettings.getState().load()
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
  const patchLayout = useUi((s) => s.patchLayout)
  const sidebarWidth = useUi((s) => s.layout.sidebarWidth)
  const sidebarOpen = useUi((s) => s.layout.sidebarOpen)

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
            {sidebarOpen && (
              <ResizeHandle
                axis="horizontal"
                data-testid="resize-sidebar"
                onDelta={(delta) => patchLayout({ sidebarWidth: sidebarWidth + delta })}
              />
            )}
            <main className="flex min-w-0 flex-1 flex-col bg-bg">
              <Workbench />
            </main>
          </div>
        )}

        <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 font-mono text-[11px] text-muted">
          {branch && (
            <span className="inline-flex items-center gap-1">
              <Icon icon={GitBranch} className={iconSize.xs} />
              {branch}
            </span>
          )}
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

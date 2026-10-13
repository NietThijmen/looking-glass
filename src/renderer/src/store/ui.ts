import { create } from 'zustand'
import {
  loadWorkbenchLayout,
  normalizeWorkbenchLayout,
  saveWorkbenchLayout,
  type WorkbenchColumn,
  type WorkbenchLayout,
} from '../layout/workbenchState'

export type SidebarView = 'explorer' | 'search' | 'git' | 'commits'

interface UiStore {
  layout: WorkbenchLayout
  sidebar: SidebarView
  terminalOpen: boolean
  /** Bumped to ask the search input to take focus. */
  searchFocusToken: number
  /** Pty id of the terminal tab in front, for @terminal. */
  activeTerminalId: string | null
  /** Ask the terminal panel to bring a terminal to the front. */
  terminalFocus: { id: string; token: number } | null
  setActiveTerminal(id: string | null): void
  focusTerminal(id: string): void
  showSidebar(view: SidebarView): void
  /** Clicking the active view's button closes the sidebar; any other view opens it. */
  toggleSidebarView(view: SidebarView): void
  toggleSidebar(): void
  toggleTerminal(): void
  patchLayout(patch: Partial<WorkbenchLayout>): void
  reorderColumns(from: WorkbenchColumn, onto: WorkbenchColumn): void
}

export const useUi = create<UiStore>((set, get) => ({
  layout: loadWorkbenchLayout(),
  sidebar: 'explorer',
  terminalOpen: true,
  searchFocusToken: 0,
  activeTerminalId: null,
  terminalFocus: null,
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  focusTerminal: (id) =>
    set((s) => ({ terminalOpen: true, terminalFocus: { id, token: (s.terminalFocus?.token ?? 0) + 1 } })),
  showSidebar: (view) => {
    set((s) => ({
      sidebar: view,
      searchFocusToken: view === 'search' ? s.searchFocusToken + 1 : s.searchFocusToken,
    }))
    if (!get().layout.sidebarOpen) get().patchLayout({ sidebarOpen: true })
  },
  toggleSidebarView: (view) => {
    const { sidebar, layout } = get()
    if (layout.sidebarOpen && sidebar === view) get().patchLayout({ sidebarOpen: false })
    else get().showSidebar(view)
  },
  toggleSidebar: () => get().patchLayout({ sidebarOpen: !get().layout.sidebarOpen }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  patchLayout: (patch) =>
    set((s) => {
      const layout = normalizeWorkbenchLayout({ ...s.layout, ...patch })
      saveWorkbenchLayout(layout)
      return { layout }
    }),
  reorderColumns: (from, onto) => {
    const order = [...get().layout.columnOrder]
    const fromIndex = order.indexOf(from)
    const ontoIndex = order.indexOf(onto)
    if (fromIndex === -1 || ontoIndex === -1 || fromIndex === ontoIndex) return
    order.splice(fromIndex, 1)
    order.splice(ontoIndex, 0, from)
    get().patchLayout({ columnOrder: order })
  },
}))

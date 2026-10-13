import { create } from 'zustand'

export type SidebarView = 'explorer' | 'search' | 'git'

interface UiStore {
  sidebar: SidebarView
  terminalOpen: boolean
  /** Bumped to ask the search input to take focus. */
  searchFocusToken: number
  showSidebar(view: SidebarView): void
  toggleTerminal(): void
}

export const useUi = create<UiStore>((set) => ({
  sidebar: 'explorer',
  terminalOpen: true,
  searchFocusToken: 0,
  showSidebar: (view) =>
    set((s) => ({
      sidebar: view,
      searchFocusToken: view === 'search' ? s.searchFocusToken + 1 : s.searchFocusToken,
    })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
}))

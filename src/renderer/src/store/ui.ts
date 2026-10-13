import { create } from 'zustand'

export type SidebarView = 'explorer' | 'search' | 'git'

interface UiStore {
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
  toggleTerminal(): void
}

export const useUi = create<UiStore>((set) => ({
  sidebar: 'explorer',
  terminalOpen: true,
  searchFocusToken: 0,
  activeTerminalId: null,
  terminalFocus: null,
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  focusTerminal: (id) =>
    set((s) => ({ terminalOpen: true, terminalFocus: { id, token: (s.terminalFocus?.token ?? 0) + 1 } })),
  showSidebar: (view) =>
    set((s) => ({
      sidebar: view,
      searchFocusToken: view === 'search' ? s.searchFocusToken + 1 : s.searchFocusToken,
    })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
}))

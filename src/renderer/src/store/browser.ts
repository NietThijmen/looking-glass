import { create } from 'zustand'
import type { BrowserTabState, ConsoleEntry, Picked, PickMode } from '../../../shared/browser'

const MAX_CONSOLE = 500

interface BrowserStore {
  tabs: Record<string, BrowserTabState>
  console: Record<string, ConsoleEntry[]>
  /** What the user picked in each tab (elements and regions), in order. */
  picked: Record<string, Picked[]>
  /** The browser tab the user last looked at, for @browser mentions. */
  lastTabId: string | null
  /** Dev server URLs seen in terminal output, newest first. */
  detectedUrls: string[]

  setState(state: BrowserTabState): void
  addConsole(tabId: string, entry: ConsoleEntry): void
  clearConsole(tabId: string): void
  applyPick(item: Picked, mode: PickMode): void
  unpick(tabId: string, index?: number): void
  setLastTab(tabId: string): void
  remove(tabId: string): void
  detectUrl(url: string): void
  reset(): void
}

export const useBrowser = create<BrowserStore>((set) => ({
  tabs: {},
  console: {},
  picked: {},
  lastTabId: null,
  detectedUrls: [],

  setState: (state) => set((s) => ({ tabs: { ...s.tabs, [state.tabId]: state } })),
  addConsole: (tabId, entry) =>
    set((s) => ({
      console: { ...s.console, [tabId]: [...(s.console[tabId] ?? []), entry].slice(-MAX_CONSOLE) },
    })),
  clearConsole: (tabId) => set((s) => ({ console: { ...s.console, [tabId]: [] } })),
  applyPick: (item, mode) =>
    set((s) => {
      const current = s.picked[item.tabId] ?? []
      const next =
        mode === 'add'
          ? [...current, item]
          : mode === 'replace-last' && current.length
            ? [...current.slice(0, -1), item]
            : [item]
      return { picked: { ...s.picked, [item.tabId]: next } }
    }),
  unpick: (tabId, index) =>
    set((s) => ({
      picked: {
        ...s.picked,
        [tabId]: index === undefined ? [] : (s.picked[tabId] ?? []).filter((_, i) => i !== index),
      },
    })),
  setLastTab: (tabId) => set({ lastTabId: tabId }),
  remove: (tabId) =>
    set((s) => {
      const tabs = { ...s.tabs }
      delete tabs[tabId]
      return { tabs, lastTabId: s.lastTabId === tabId ? null : s.lastTabId }
    }),
  detectUrl: (url) =>
    set((s) =>
      s.detectedUrls[0] === url
        ? s
        : { detectedUrls: [url, ...s.detectedUrls.filter((u) => u !== url)].slice(0, 5) },
    ),
  reset: () => set({ tabs: {}, console: {}, picked: {}, lastTabId: null }),
}))

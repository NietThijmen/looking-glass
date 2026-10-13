import { create } from 'zustand'
import type { FsChange } from '../../../shared/ipc'

/** file = editor, diff = against git HEAD, review = agent changes against their review baseline, settings = the one settings tab. */
export type TabKind = 'file' | 'diff' | 'review' | 'browser' | 'settings'

export interface Tab {
  id: string
  kind: TabKind
  path: string
}

export interface Buffer {
  /** Contents handed to the editor when it was (re)mounted. Stable for an edit session. */
  base: string
  /** Contents on disk as far as we know. */
  saved: string
  /** Current editor contents. */
  draft: string
  /** Bumped when the buffer is replaced from disk; part of the editor's key. */
  version: number
  binary: boolean
  tooLarge: boolean
  /** Changed on disk while the buffer had unsaved edits. */
  conflict: boolean
}

export interface RevealTarget {
  path: string
  line: number
  column: number
}

interface EditorStore {
  tabs: Tab[]
  activeId: string | null
  buffers: Record<string, Buffer>
  loading: Record<string, boolean>
  errors: Record<string, string>
  reveal: RevealTarget | null

  openFile(path: string, reveal?: { line: number; column: number }): Promise<void>
  openDiff(path: string): Promise<void>
  openReview(path: string): void
  openSettings(): void
  /** Browser tabs use their browser tab id as `path`. */
  openBrowser(url: string): Promise<void>
  adoptBrowser(tabId: string): void
  activate(id: string): void
  closeTab(id: string): void
  setDraft(path: string, draft: string): void
  save(path?: string): Promise<void>
  reloadFromDisk(path: string): Promise<void>
  applyFsChanges(changes: FsChange[]): void
  consumeReveal(): RevealTarget | null
  reset(): void
}

const tabId = (kind: TabKind, path: string): string => `${kind}:${path}`

export function isDirty(buffer: Buffer | undefined): boolean {
  return !!buffer && buffer.draft !== buffer.saved
}

export const useEditor = create<EditorStore>((set, get) => {
  async function ensureBuffer(path: string): Promise<void> {
    if (get().buffers[path] || get().loading[path]) return
    set((s) => ({ loading: { ...s.loading, [path]: true } }))
    try {
      const file = await window.lookingglass.fs.readFile(path)
      set((s) => ({
        buffers: {
          ...s.buffers,
          [path]: {
            base: file.contents,
            saved: file.contents,
            draft: file.contents,
            version: 0,
            binary: file.binary,
            tooLarge: file.tooLarge,
            conflict: false,
          },
        },
        errors: Object.fromEntries(Object.entries(s.errors).filter(([p]) => p !== path)),
      }))
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [path]: String(error) } }))
    } finally {
      set((s) => ({ loading: { ...s.loading, [path]: false } }))
    }
  }

  function openTab(kind: TabKind, path: string): void {
    const id = tabId(kind, path)
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, { id, kind, path }],
      activeId: id,
    }))
  }

  return {
    tabs: [],
    activeId: null,
    buffers: {},
    loading: {},
    errors: {},
    reveal: null,

    async openFile(path, reveal) {
      openTab('file', path)
      if (reveal) set({ reveal: { path, ...reveal } })
      await ensureBuffer(path)
    },

    async openDiff(path) {
      openTab('diff', path)
      await ensureBuffer(path).catch(() => undefined)
    },

    openReview(path) {
      openTab('review', path)
    },

    openSettings() {
      openTab('settings', 'settings')
    },

    async openBrowser(url) {
      const state = await window.lookingglass.browser.create(url)
      openTab('browser', state.tabId)
    },

    adoptBrowser(tabId) {
      openTab('browser', tabId)
    },

    activate(id) {
      set({ activeId: id })
    },

    closeTab(id) {
      const closing = get().tabs.find((t) => t.id === id)
      if (closing?.kind === 'browser') void window.lookingglass.browser.close(closing.path)
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id)
        if (index === -1) return s
        const tabs = s.tabs.filter((t) => t.id !== id)
        const closed = s.tabs[index]!
        let activeId = s.activeId
        if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1])?.id ?? null
        // Drop the buffer once no tab shows it, unless it has unsaved edits.
        const buffers = { ...s.buffers }
        if (!tabs.some((t) => t.path === closed.path) && !isDirty(buffers[closed.path])) {
          delete buffers[closed.path]
        }
        return { tabs, activeId, buffers }
      })
    },

    setDraft(path, draft) {
      set((s) => {
        const buffer = s.buffers[path]
        if (!buffer || buffer.draft === draft) return s
        return { buffers: { ...s.buffers, [path]: { ...buffer, draft } } }
      })
    },

    async save(path) {
      const target = path ?? get().tabs.find((t) => t.id === get().activeId)?.path
      const buffer = target ? get().buffers[target] : undefined
      if (!target || !buffer || buffer.binary || buffer.tooLarge) return
      const draft = buffer.draft
      await window.lookingglass.fs.writeFile(target, draft)
      set((s) => {
        const current = s.buffers[target]
        if (!current) return s
        return { buffers: { ...s.buffers, [target]: { ...current, saved: draft, conflict: false } } }
      })
    },

    async reloadFromDisk(path) {
      const file = await window.lookingglass.fs.readFile(path)
      set((s) => {
        const current = s.buffers[path]
        if (!current) return s
        return {
          buffers: {
            ...s.buffers,
            [path]: {
              ...current,
              base: file.contents,
              saved: file.contents,
              draft: file.contents,
              version: current.version + 1,
              binary: file.binary,
              tooLarge: file.tooLarge,
              conflict: false,
            },
          },
        }
      })
    },

    applyFsChanges(changes) {
      for (const change of changes) {
        const buffer = get().buffers[change.path]
        if (!buffer || change.type === 'delete') continue
        void window.lookingglass.fs
          .readFile(change.path)
          .then((file) => {
            const current = get().buffers[change.path]
            // Our own save, or nothing actually changed.
            if (!current || file.contents === current.saved) return
            if (isDirty(current)) {
              set((s) => ({ buffers: { ...s.buffers, [change.path]: { ...current, conflict: true } } }))
            } else {
              void get().reloadFromDisk(change.path)
            }
          })
          .catch(() => undefined)
      }
    },

    consumeReveal() {
      const reveal = get().reveal
      if (reveal) set({ reveal: null })
      return reveal
    },

    reset() {
      set({ tabs: [], activeId: null, buffers: {}, loading: {}, errors: {}, reveal: null })
    },
  }
})

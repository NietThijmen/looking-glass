import { create } from 'zustand'
import type { Diagnostic, DiagnosticsByPath } from '@lookingglass/shared/diagnostics'

interface DiagnosticsStore {
  byPath: DiagnosticsByPath
  /** Why there are no diagnostics, when the language server couldn't start. */
  error: string | null
  set(path: string, diagnostics: Diagnostic[]): void
  load(): Promise<void>
  reset(): void
}

export const useDiagnostics = create<DiagnosticsStore>((set) => ({
  byPath: {},
  error: null,
  set: (path, diagnostics) =>
    set((s) => {
      const byPath = { ...s.byPath }
      if (diagnostics.length) byPath[path] = diagnostics
      else delete byPath[path]
      return { byPath }
    }),
  load: async () => {
    const { diagnostics, error } = await window.lookingglass.diagnostics.all()
    set({ byPath: diagnostics, error })
  },
  reset: () => set({ byPath: {}, error: null }),
}))

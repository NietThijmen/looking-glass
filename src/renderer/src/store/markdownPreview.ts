import { create } from 'zustand'

/** Whether a markdown file's tab shows the rendered preview instead of the source. */
interface MarkdownPreviewState {
  previewing: Record<string, boolean>
  toggle: (path: string) => void
}

export const useMarkdownPreview = create<MarkdownPreviewState>((set) => ({
  previewing: {},
  toggle: (path) => set((s) => ({ previewing: { ...s.previewing, [path]: !s.previewing[path] } })),
}))

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

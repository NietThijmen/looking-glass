import { Editor, type EditorFactory } from '@pierre/diffs/edit'

export const THEME = { dark: 'pierre-dark', light: 'pierre-light' } as const

/** Shared look for every @pierre/diffs surface. */
export const baseOptions = {
  theme: THEME,
  // Follows prefers-color-scheme, which main sets from the theme setting.
  themeType: 'system',
  overflow: 'scroll',
  disableFileHeader: true,
} as const

/**
 * Every editor gets the main-process clipboard: the sandboxed renderer has no
 * clipboard-read permission, which @pierre/diffs would otherwise need for paste.
 */
export const createEditor: EditorFactory<undefined, undefined> = (type, options, editStateKey) =>
  new Editor(
    type,
    { ...options, clipboard: { readText: () => window.lookingglass.clipboard.readText() } },
    editStateKey,
  )

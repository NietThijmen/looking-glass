import type { EditorSnapshot } from '../../shared/agent'

/**
 * Main's copy of what the editor has open, pushed by the renderer. Agent file
 * reads prefer unsaved contents from here so the agent sees what the user sees.
 */
export class EditorState {
  #snapshot: EditorSnapshot = { openFiles: [], activeFile: null, dirty: {} }

  get snapshot(): EditorSnapshot {
    return this.#snapshot
  }

  update(snapshot: EditorSnapshot): void {
    this.#snapshot = snapshot
  }

  /** Unsaved contents for a workspace-relative path, if the editor has any. */
  unsaved(path: string): string | undefined {
    return Object.hasOwn(this.#snapshot.dirty, path) ? this.#snapshot.dirty[path] : undefined
  }

  reset(): void {
    this.#snapshot = { openFiles: [], activeFile: null, dirty: {} }
  }
}

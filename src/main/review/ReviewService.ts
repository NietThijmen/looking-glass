import type { ReviewEntry } from '@lookingglass/shared/review'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import type { Checkpoints } from './Checkpoints'

const COLLECT_DEBOUNCE_MS = 400

/**
 * Agent edits land on disk immediately (so the agent's own builds and tests see
 * them), and are reviewed afterwards against a baseline:
 *
 * - every prompt turn starts with a checkpoint (a snapshot of the work tree);
 * - files that differ from the turn's checkpoint join the review set, with the
 *   checkpoint contents as their baseline; this also catches agents that write
 *   with their own tools instead of ACP `fs/write_text_file`;
 * - accepting moves the baseline to the current contents, rejecting writes the
 *   baseline back. Per-hunk decisions do the same for part of a file.
 *
 * A baseline of `null` means the file didn't exist.
 */
export class ReviewService {
  #base = new Map<string, string | null>()
  #turns = new Map<string, string>()
  #timer: NodeJS.Timeout | undefined
  #collecting: Promise<void> = Promise.resolve()

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly checkpoints: () => Checkpoints | null,
    private readonly onChange: (entries: ReviewEntry[]) => void,
  ) {}

  /** Take a checkpoint and start tracking a turn. Returns null when snapshots are unavailable. */
  async beginTurn(sessionId: string): Promise<string | null> {
    const store = this.checkpoints()
    if (!store) return null
    try {
      const tree = await store.snapshot()
      this.#turns.set(sessionId, tree)
      return tree
    } catch (error) {
      console.error('[review] checkpoint failed', error)
      return null
    }
  }

  async endTurn(sessionId: string): Promise<void> {
    const tree = this.#turns.get(sessionId)
    this.#turns.delete(sessionId)
    if (tree) await this.#collect([tree])
  }

  /** Workspace files changed on disk; while turns run, pick up agent edits as they happen. */
  notifyFsChange(): void {
    if (!this.#turns.size) return
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#collect([...this.#turns.values()]), COLLECT_DEBOUNCE_MS)
  }

  /** An agent wrote through ACP; `before` is what was on disk. Covers workspaces without snapshots. */
  async recordAgentWrite(path: string, before: string | null): Promise<void> {
    if (!this.#base.has(path)) this.#base.set(path, before)
    await this.#prune()
  }

  entries(): Promise<ReviewEntry[]> {
    return this.#entries()
  }

  base(path: string): string | null | undefined {
    return this.#base.get(path)
  }

  async accept(path: string | null): Promise<void> {
    if (path === null) this.#base.clear()
    else this.#base.delete(path)
    await this.#prune()
  }

  async reject(path: string | null): Promise<void> {
    const paths = path === null ? [...this.#base.keys()] : [path]
    for (const p of paths) {
      const base = this.#base.get(p)
      if (base === undefined) continue
      if (base === null) await this.workspace.deleteFile(p)
      else await this.workspace.writeFile(p, base)
      this.#base.delete(p)
    }
    await this.#prune()
  }

  /** Per-hunk accept: the baseline absorbs part of the change. */
  async setBase(path: string, content: string): Promise<void> {
    if (!this.#base.has(path)) return
    this.#base.set(path, content)
    await this.#prune()
  }

  /** Per-hunk reject: the file on disk loses part of the change. */
  async writeCurrent(path: string, content: string): Promise<void> {
    await this.workspace.writeFile(path, content)
    await this.#prune()
  }

  /** Put the work tree back the way it was at `tree`, for files changed since. */
  async restore(tree: string): Promise<void> {
    const store = this.checkpoints()
    if (!store) throw new Error('Checkpoints are unavailable for this folder.')
    const now = await store.snapshot()
    for (const change of await store.changes(tree, now)) {
      if (change.status === 'A') {
        await this.workspace.deleteFile(change.path)
      } else {
        const content = await store.read(tree, change.path)
        if (content !== null) await this.workspace.writeFile(change.path, content)
      }
    }
    await this.#prune()
  }

  reset(): void {
    clearTimeout(this.#timer)
    this.#base.clear()
    this.#turns.clear()
  }

  #collect(trees: string[]): Promise<void> {
    // Serialize: snapshots share one shadow index.
    this.#collecting = this.#collecting.then(async () => {
      const store = this.checkpoints()
      if (!store) return
      try {
        const now = await store.snapshot()
        for (const tree of trees) {
          for (const change of await store.changes(tree, now)) {
            if (this.#base.has(change.path) || !(await this.#reviewable(change.path))) continue
            const base = change.status === 'A' ? null : await store.read(tree, change.path)
            if (base?.includes('\0')) continue
            this.#base.set(change.path, base)
          }
        }
      } catch (error) {
        console.error('[review] collecting changes failed', error)
      }
      await this.#prune()
    })
    return this.#collecting
  }

  /** Text files only: binary and oversized files aren't diffable, so they skip review. */
  async #reviewable(path: string): Promise<boolean> {
    const file = await this.workspace.readFile(path).catch(() => null)
    return !file || (!file.binary && !file.tooLarge)
  }

  /** Drop files that are back to their baseline, then publish. */
  async #prune(): Promise<void> {
    for (const [path, base] of this.#base) {
      const current = await this.workspace.readText(path)
      if (current === base) this.#base.delete(path)
    }
    this.onChange(await this.#entries())
  }

  async #entries(): Promise<ReviewEntry[]> {
    const entries: ReviewEntry[] = []
    for (const [path, base] of this.#base) {
      const current = await this.workspace.readText(path)
      entries.push({ path, status: base === null ? 'added' : current === null ? 'deleted' : 'modified' })
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }
}

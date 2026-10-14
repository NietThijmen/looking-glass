import { create } from 'zustand'
import type { ReviewEntry } from '@lookingglass/shared/review'

interface ReviewStore {
  entries: ReviewEntry[]
  /** Bumped whenever a reviewed file or its baseline may have changed, so views refetch. */
  version: number
  set(entries: ReviewEntry[]): void
  touch(paths: string[]): void
  load(): Promise<void>
}

export const useReview = create<ReviewStore>((set, get) => ({
  entries: [],
  version: 0,
  set: (entries) => set((s) => ({ entries, version: s.version + 1 })),
  touch: (paths) => {
    const reviewed = new Set(get().entries.map((e) => e.path))
    if (paths.some((p) => reviewed.has(p))) set((s) => ({ version: s.version + 1 }))
  },
  load: async () => get().set(await window.lookingglass.review.list()),
}))

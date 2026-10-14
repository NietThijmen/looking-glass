import { basename } from '../lib/paths'

/** Which composer chips to show. `dirty` is a git repo with changes; `pullRequest` is an open PR or null. */
export function visibleHints(state: { dirty: boolean; pullRequest: unknown }): {
  commit: boolean
  commitAndPush: boolean
  viewPr: boolean
} {
  return {
    commit: state.dirty,
    commitAndPush: state.dirty,
    viewPr: state.pullRequest != null,
  }
}

/** Prefill for the commit chip: `Update Hero.tsx`, or `Update 3 files`. */
export function suggestedCommitMessage(paths: readonly string[]): string {
  const only = paths.length === 1 ? paths[0] : undefined
  if (only) return `Update ${basename(only)}`
  return `Update ${paths.length} files`
}

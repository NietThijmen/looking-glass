import { useWorkspace } from '../store/workspace'

export interface CommitFeedback {
  ok: boolean
  text: string
}

/**
 * The git panel's commit sequence, shared with the composer chips.
 * Commit and push stay the existing IPC; this only orders them and words the result.
 */
export async function runCommit(message: string, pushAfter: boolean): Promise<CommitFeedback> {
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, text: 'Write a commit message first.' }
  const commit = await window.lookingglass.git.commit(trimmed)
  if (!commit.ok) return { ok: false, text: commit.error ?? 'Commit failed' }
  if (pushAfter) {
    const push = await window.lookingglass.git.push()
    await useWorkspace.getState().refreshGit()
    if (!push.ok) {
      return {
        ok: false,
        text: `Committed ${commit.shortHash}, but push failed: ${push.error ?? 'unknown error'}`,
      }
    }
    return { ok: true, text: `Committed and pushed ${commit.shortHash}` }
  }
  await useWorkspace.getState().refreshGit()
  return { ok: true, text: `Committed ${commit.shortHash}` }
}

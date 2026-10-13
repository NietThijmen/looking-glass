import type { ContentBlock } from '@agentclientprotocol/sdk'
import { create } from 'zustand'
import { selectionOrLine, type SelectionInfo } from '../editor/selection'
import { basename } from '../lib/paths'
import { useAgents } from '../store/agents'
import { isDirty, useEditor } from '../store/editor'
import { useReview } from '../store/review'
import { useWorkspace } from '../store/workspace'

interface InlineEditStore {
  /** The code the Cmd+K prompt is open for. */
  target: SelectionInfo | null
  open(path: string): boolean
  close(): void
}

export const useInlineEdit = create<InlineEditStore>((set) => ({
  target: null,
  open: (path) => {
    const target = selectionOrLine(path)
    set({ target })
    return target !== null
  },
  close: () => set({ target: null }),
}))

/** Cmd+K in the active file tab. */
export function openInlineEdit(): void {
  const { tabs, activeId } = useEditor.getState()
  const tab = tabs.find((t) => t.id === activeId)
  if (tab?.kind === 'file') useInlineEdit.getState().open(tab.path)
}

export function inlineEditPrompt(target: SelectionInfo, instruction: string): string {
  const lines =
    target.startLine === target.endLine
      ? `line ${target.startLine}`
      : `lines ${target.startLine}-${target.endLine}`
  return [
    `Edit ${target.path} ${lines} as follows: ${instruction}`,
    '',
    `Change only that code unless the instruction needs more. Write the change to the file directly; don't just describe it. Keep the reply short.`,
  ].join('\n')
}

/**
 * Run a Cmd+K edit as its own chat on the default agent, so it can be watched and
 * stopped like any other. The file is saved first (the agent edits it on disk); the
 * result opens in the review view.
 */
export async function runInlineEdit(target: SelectionInfo, instruction: string): Promise<void> {
  const editor = useEditor.getState()
  if (isDirty(editor.buffers[target.path])) await editor.save(target.path)
  const agents = useAgents.getState()
  const key = await agents.newChat(undefined, {
    title: `Edit ${basename(target.path)}:${target.startLine}${target.endLine !== target.startLine ? `-${target.endLine}` : ''}`,
  })
  const chat = useAgents.getState().chats.find((c) => c.key === key)
  if (chat?.state !== 'ready') return
  const root = useWorkspace.getState().info?.root ?? ''
  const uri = encodeURI(`file://${root}/${target.path}#L${target.startLine}-L${target.endLine}`)
  const code: ContentBlock = chat.promptCapabilities.embeddedContext
    ? { type: 'resource', resource: { uri, text: target.text, mimeType: 'text/plain' } }
    : { type: 'text', text: `The code:\n\`\`\`\n${target.text}\n\`\`\`` }
  await useAgents
    .getState()
    .send(key, inlineEditPrompt(target, instruction), [
      { label: `${basename(target.path)}:${target.startLine}`, blocks: [code] },
    ])
  if (useReview.getState().entries.some((e) => e.path === target.path))
    useEditor.getState().openReview(target.path)
}

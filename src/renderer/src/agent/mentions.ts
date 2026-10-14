import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk'
import { selectionIn } from '../editor/selection'
import { basename } from '../lib/paths'
import type { Attachment } from '../store/agents'
import { formatDiagnostics } from '@lookingglass/shared/diagnostics'
import { consoleAttachment } from '../browser/elementAttachment'
import { useDiagnostics } from '../store/diagnostics'
import { useBrowser } from '../store/browser'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { recentOutput } from '../terminal/terminalBus'

export type MentionOption =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'selection' }
  | { kind: 'terminal' }
  | { kind: 'git-diff' }
  | { kind: 'browser' }
  | { kind: 'browser-console' }
  | { kind: 'problems' }

const MAX_OPTIONS = 12
const TERMINAL_CHARS = 8000

export function optionLabel(option: MentionOption): string {
  switch (option.kind) {
    case 'file':
    case 'folder':
      return option.path + (option.kind === 'folder' ? '/' : '')
    case 'selection':
      return 'selection'
    case 'terminal':
      return 'terminal'
    case 'git-diff':
      return 'git-diff'
    case 'browser':
      return 'browser'
    case 'browser-console':
      return 'browser-console'
    case 'problems':
      return 'problems'
  }
}

/** Subsequence match scored to prefer basename hits and contiguous runs. Lower is better; null = no match. */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return target.length
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let score = 0
  let ti = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += found - last - 1
    last = found
    ti = found + 1
  }
  const base = t.lastIndexOf('/') + 1
  if (t.slice(base).includes(q)) score -= 100
  return score + t.length / 100
}

/** Options for `@query`: special mentions first, then fuzzy-matched files and folders. */
export function mentionOptions(query: string, files: string[]): MentionOption[] {
  const specials: MentionOption[] = [
    { kind: 'selection' },
    { kind: 'terminal' },
    { kind: 'git-diff' },
    { kind: 'browser' },
    { kind: 'browser-console' },
    { kind: 'problems' },
  ]
  const folders = new Set<string>()
  for (const file of files) {
    for (let i = file.indexOf('/'); i !== -1; i = file.indexOf('/', i + 1)) folders.add(file.slice(0, i))
  }
  const candidates: MentionOption[] = [
    ...files.map((path) => ({ kind: 'file' as const, path })),
    ...[...folders].map((path) => ({ kind: 'folder' as const, path })),
  ]
  const scored = candidates
    .map((option) => ({ option, score: fuzzyScore(query, optionLabel(option)) }))
    .filter((x): x is { option: MentionOption; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.option)
  const matchingSpecials = specials.filter((s) => optionLabel(s).startsWith(query.toLowerCase()))
  return [...matchingSpecials, ...scored].slice(0, MAX_OPTIONS)
}

function fileUri(path: string): string {
  const root = useWorkspace.getState().info?.root ?? ''
  return encodeURI(`file://${root}/${path}`)
}

/** Turn a picked mention into what gets sent. Returns null (with a reason) when there is nothing to attach. */
export async function resolveMention(
  option: MentionOption,
  caps: PromptCapabilities,
): Promise<Attachment | { error: string }> {
  switch (option.kind) {
    case 'file': {
      if (!caps.embeddedContext) {
        return {
          label: basename(option.path),
          blocks: [{ type: 'resource_link', uri: fileUri(option.path), name: option.path }],
        }
      }
      // Embed what the user sees, including unsaved edits.
      const draft = useEditor.getState().buffers[option.path]?.draft
      const file = draft === undefined ? await window.lookingglass.fs.readFile(option.path) : null
      if (file?.binary || file?.tooLarge) {
        return {
          label: basename(option.path),
          blocks: [{ type: 'resource_link', uri: fileUri(option.path), name: option.path }],
        }
      }
      const block: ContentBlock = {
        type: 'resource',
        resource: { uri: fileUri(option.path), text: draft ?? file?.contents ?? '', mimeType: 'text/plain' },
      }
      return { label: basename(option.path), blocks: [block] }
    }
    case 'folder':
      return {
        label: `${basename(option.path)}/`,
        blocks: [{ type: 'resource_link', uri: fileUri(option.path), name: `${option.path}/` }],
      }
    case 'selection': {
      const editor = useEditor.getState()
      const active = editor.tabs.find((t) => t.id === editor.lastCodeId && t.kind === 'file')
      const selection = active ? selectionIn(active.path) : null
      if (!selection) return { error: 'Select some code in the editor first.' }
      const where = `${selection.path}:${selection.startLine}-${selection.endLine}`
      const block: ContentBlock = caps.embeddedContext
        ? {
            type: 'resource',
            resource: {
              uri: `${fileUri(selection.path)}#L${selection.startLine}-L${selection.endLine}`,
              text: selection.text,
              mimeType: 'text/plain',
            },
          }
        : { type: 'text', text: `Selected code from ${where}:\n\`\`\`\n${selection.text}\n\`\`\`` }
      return {
        label: `${basename(selection.path)}:${selection.startLine}-${selection.endLine}`,
        blocks: [block],
      }
    }
    case 'terminal': {
      const id = useUi.getState().activeTerminalId
      const output = id ? recentOutput(id).slice(-TERMINAL_CHARS).trim() : ''
      if (!output) return { error: 'The terminal has no output yet.' }
      return {
        label: 'terminal',
        blocks: [{ type: 'text', text: `Recent terminal output:\n\`\`\`\n${output}\n\`\`\`` }],
      }
    }
    case 'browser': {
      const tabId = useBrowser.getState().lastTabId
      if (!tabId) return { error: 'No browser tab is open.' }
      const state = useBrowser.getState().tabs[tabId]
      const blocks: ContentBlock[] = [
        { type: 'text', text: `Browser page: ${state?.title || '(untitled)'} — ${state?.url ?? ''}` },
      ]
      if (caps.image)
        blocks.push({
          type: 'image',
          mimeType: 'image/png',
          data: await window.lookingglass.browser.screenshot(tabId),
        })
      return { label: 'browser', blocks }
    }
    case 'browser-console': {
      const tabId = useBrowser.getState().lastTabId
      const entries = tabId ? (useBrowser.getState().console[tabId] ?? []) : []
      const relevant = entries.filter((e) => e.level === 'error' || e.level === 'warning').slice(-50)
      if (!relevant.length) return { error: 'No browser errors or warnings.' }
      return consoleAttachment(relevant)
    }
    case 'problems': {
      const { byPath, error } = useDiagnostics.getState()
      if (!Object.keys(byPath).length)
        return { error: error ? `No diagnostics: ${error.split('\n')[0]}` : 'No problems in the open files.' }
      return {
        label: 'problems',
        blocks: [{ type: 'text', text: `Problems in the open files:\n${formatDiagnostics(byPath)}` }],
      }
    }
    case 'git-diff': {
      const diff = (await window.lookingglass.git.diff()).trim()
      if (!diff) return { error: 'No uncommitted changes.' }
      return {
        label: 'git diff',
        blocks: [{ type: 'text', text: `Uncommitted changes (git diff HEAD):\n\`\`\`diff\n${diff}\n\`\`\`` }],
      }
    }
  }
}

/** Read an image file (pasted or dropped) as an ACP image block. */
export function imageAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = String(reader.result)
      const data = url.slice(url.indexOf(',') + 1)
      resolve({ label: file.name || 'image', blocks: [{ type: 'image', mimeType: file.type, data }] })
    }
    reader.readAsDataURL(file)
  })
}

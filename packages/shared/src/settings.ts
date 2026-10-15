import { DEFAULT_EXTERNAL_EDITOR, type ExternalEditorId } from './editors'
import type { MenuCommand } from './ipc'

export type ThemeSetting = 'dark' | 'light' | 'system'

/** A re-usable prompt, run from the composer as `!name`. */
export interface SavedPrompt {
  name: string
  text: string
}

/** Letters, digits, `-` and `_`, so `!name` ends at the first space. */
export const PROMPT_NAME = /^[\w-]+$/

/** Whether a prompt's text uses `$1`…`$9` or `$ARGUMENTS`. */
export function usesArguments(text: string): boolean {
  return /\$(ARGUMENTS|[1-9])/.test(text)
}

/** Splits the arguments after `!name` on spaces; "double" or 'single' quotes group words. */
export function splitArguments(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!)
}

/**
 * Replaces each `!name` that matches a saved prompt with the prompt's text. The rest of the line
 * after `!name` is its arguments: `$1`…`$9` and `$ARGUMENTS` in the text are filled in, and when
 * the text has none the arguments are appended to it.
 */
export function expandPrompts(text: string, prompts: SavedPrompt[]): string {
  if (!prompts.length) return text
  return text.replace(/(^|\s)!([\w-]+)([^\n]*)/g, (whole, lead: string, name: string, rest: string) => {
    const prompt = prompts.find((p) => p.name === name)
    if (!prompt) return whole
    // `!name` must end at a space or the end of the line (so `!release.` is not a call).
    if (rest && !/^\s/.test(rest)) return whole
    const raw = rest.trim()
    if (!usesArguments(prompt.text)) return lead + (raw ? `${prompt.text} ${raw}` : prompt.text)
    const args = splitArguments(raw)
    const filled = prompt.text.replace(/\$(ARGUMENTS|[1-9])/g, (_, ref: string) =>
      ref === 'ARGUMENTS' ? raw : (args[Number(ref) - 1] ?? ''),
    )
    return lead + filled
  })
}

/** App-wide preferences, stored in the app's userData folder. */
export interface UserSettings {
  theme: ThemeSetting
  /** Where "Open in editor" sends files. */
  externalEditor: ExternalEditorId
  /** Electron accelerators that replace the defaults below; an empty string removes the shortcut. */
  keybindings: Partial<Record<MenuCommand, string>>
  /** Re-usable prompts, run from the composer as `!name`. */
  prompts: SavedPrompt[]
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  externalEditor: DEFAULT_EXTERNAL_EDITOR,
  keybindings: {},
  prompts: [],
}

export interface CommandInfo {
  command: MenuCommand
  label: string
  menu: 'File' | 'View' | 'Agent'
  defaultKey: string
}

/** Every menu command with its default shortcut, in menu order. */
export const COMMANDS: CommandInfo[] = [
  { command: 'open-folder', label: 'Open Folder…', menu: 'File', defaultKey: 'CmdOrCtrl+O' },
  { command: 'save', label: 'Save', menu: 'File', defaultKey: 'CmdOrCtrl+S' },
  { command: 'close-tab', label: 'Close Tab', menu: 'File', defaultKey: 'CmdOrCtrl+W' },
  { command: 'open-settings', label: 'Settings…', menu: 'File', defaultKey: 'CmdOrCtrl+,' },
  { command: 'show-explorer', label: 'Explorer', menu: 'View', defaultKey: 'CmdOrCtrl+Shift+E' },
  { command: 'show-search', label: 'Search', menu: 'View', defaultKey: 'CmdOrCtrl+Shift+F' },
  { command: 'show-git', label: 'Source Control', menu: 'View', defaultKey: 'Ctrl+Shift+G' },
  { command: 'show-commits', label: 'Commits', menu: 'View', defaultKey: 'Ctrl+Shift+H' },
  {
    command: 'show-pull-requests',
    label: 'Pull Requests',
    menu: 'View',
    defaultKey: 'Ctrl+Shift+R',
  },
  { command: 'show-agents', label: 'Agents', menu: 'View', defaultKey: 'CmdOrCtrl+Shift+A' },
  { command: 'toggle-sidebar', label: 'Toggle Sidebar', menu: 'View', defaultKey: 'CmdOrCtrl+B' },
  { command: 'toggle-terminal', label: 'Toggle Terminal', menu: 'View', defaultKey: 'Ctrl+`' },
  { command: 'new-browser-tab', label: 'New Browser Tab', menu: 'View', defaultKey: 'CmdOrCtrl+Shift+B' },
  {
    command: 'toggle-picker',
    label: 'Pick Element in Browser',
    menu: 'View',
    defaultKey: 'CmdOrCtrl+Shift+C',
  },
  { command: 'inline-edit', label: 'Edit Selection with Agent…', menu: 'Agent', defaultKey: 'CmdOrCtrl+K' },
]

export function keyFor(settings: UserSettings, command: MenuCommand): string {
  return settings.keybindings[command] ?? COMMANDS.find((c) => c.command === command)?.defaultKey ?? ''
}

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
])
const NAMED_KEYS = new Set([
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
])

/** Whether Electron accepts `accelerator` (empty means "no shortcut"). */
export function isValidAccelerator(accelerator: string): boolean {
  if (accelerator === '') return true
  const parts = accelerator.split('+')
  const key = parts.pop()
  if (!key || parts.some((p) => !MODIFIERS.has(p))) return false
  return (
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1\d|2[0-4])$/.test(key) ||
    NAMED_KEYS.has(key) ||
    /^[`\-=[\];',./\\]$/.test(key)
  )
}

/** The parts of a DOM KeyboardEvent the recorder needs (shared code has no DOM types). */
export interface KeyPress {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** An accelerator for a key press in the shortcut recorder, or null for a bare modifier. */
export function acceleratorFromEvent(e: KeyPress, isMac: boolean): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  // `code` ignores Shift and Option, so ⇧⌘E stays "E" rather than "É".
  const fromCode = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1]
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    '+': 'Plus',
    Escape: 'Esc',
  }
  const codeKeys: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
  }
  const key =
    fromCode ?? codeKeys[e.code] ?? named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const parts: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('CmdOrCtrl')
  if (isMac && e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  const accelerator = parts.join('+')
  return isValidAccelerator(accelerator) ? accelerator : null
}

/** Readable form of an accelerator, with macOS symbols on macOS. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  if (!accelerator) return '—'
  if (!isMac) return accelerator.replace('CmdOrCtrl', 'Ctrl').replace('CommandOrControl', 'Ctrl')
  const symbols: Record<string, string> = {
    CmdOrCtrl: '⌘',
    CommandOrControl: '⌘',
    Cmd: '⌘',
    Command: '⌘',
    Ctrl: '⌃',
    Control: '⌃',
    Alt: '⌥',
    Option: '⌥',
    Shift: '⇧',
  }
  return accelerator
    .split('+')
    .map((p) => symbols[p] ?? p)
    .join('')
}

/** A user-configured agent from `~/.lookingglass/agents.json`. */
export interface CustomAgentConfig {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
}

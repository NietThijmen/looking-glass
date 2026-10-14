/** External editors a file can be opened in. */
export type ExternalEditorId =
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf'
  | 'idea'
  | 'webstorm'
  | 'phpstorm'
  | 'pycharm'
  | 'goland'
  | 'rubymine'
  | 'clion'
  | 'rider'
  | 'rustrover'

interface UrlEditor {
  id: ExternalEditorId
  label: string
  kind: 'url'
  /** URL scheme registered by the app: `<scheme>://file/<path>:<line>:<column>`. */
  scheme: string
}

interface CliEditor {
  id: ExternalEditorId
  label: string
  kind: 'cli'
  /** Launcher on PATH (JetBrains "Create Command-line Launcher" / Toolbox scripts). */
  command: string
  /** macOS: app bundle name and the launcher inside it, used when `command` isn't on PATH. */
  macApp: { bundle: string; executable: string }
}

export type ExternalEditor = UrlEditor | CliEditor

const jetbrains = (id: ExternalEditorId, label: string, command: string, bundle: string): CliEditor => ({
  id,
  label,
  kind: 'cli',
  command,
  macApp: { bundle, executable: command },
})

export const EXTERNAL_EDITORS: ExternalEditor[] = [
  { id: 'vscode', label: 'VS Code', kind: 'url', scheme: 'vscode' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', kind: 'url', scheme: 'vscode-insiders' },
  { id: 'cursor', label: 'Cursor', kind: 'url', scheme: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', kind: 'url', scheme: 'windsurf' },
  jetbrains('idea', 'IntelliJ IDEA', 'idea', 'IntelliJ IDEA'),
  jetbrains('webstorm', 'WebStorm', 'webstorm', 'WebStorm'),
  jetbrains('phpstorm', 'PhpStorm', 'phpstorm', 'PhpStorm'),
  jetbrains('pycharm', 'PyCharm', 'pycharm', 'PyCharm'),
  jetbrains('goland', 'GoLand', 'goland', 'GoLand'),
  jetbrains('rubymine', 'RubyMine', 'rubymine', 'RubyMine'),
  jetbrains('clion', 'CLion', 'clion', 'CLion'),
  jetbrains('rider', 'Rider', 'rider', 'Rider'),
  jetbrains('rustrover', 'RustRover', 'rustrover', 'RustRover'),
]

export const DEFAULT_EXTERNAL_EDITOR: ExternalEditorId = 'vscode'

export function isExternalEditorId(value: unknown): value is ExternalEditorId {
  return EXTERNAL_EDITORS.some((e) => e.id === value)
}

export function externalEditor(id: ExternalEditorId): ExternalEditor {
  return EXTERNAL_EDITORS.find((e) => e.id === id) ?? EXTERNAL_EDITORS[0]!
}

/** How to launch an editor at a location. Columns and lines are 1-based. */
export type EditorLaunch =
  { type: 'url'; url: string } | { type: 'cli'; command: string; args: string[]; macApp: CliEditor['macApp'] }

/** `/Users/me/a b.ts` or `C:\a\b.ts` as the path part of a `scheme://file/…` URL. */
function urlPath(abs: string): string {
  const slashed = abs.replaceAll('\\', '/')
  return encodeURI(slashed.startsWith('/') ? slashed : `/${slashed}`)
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
}

export function editorLaunch(
  id: ExternalEditorId,
  absPath: string,
  line?: number,
  column?: number,
): EditorLaunch {
  const editor = externalEditor(id)
  const l = line && line > 0 ? Math.floor(line) : undefined
  const c = column && column > 0 ? Math.floor(column) : undefined
  if (editor.kind === 'url') {
    const position = l ? `:${l}${c ? `:${c}` : ''}` : ''
    return { type: 'url', url: `${editor.scheme}://file${urlPath(absPath)}${position}` }
  }
  const args = [...(l ? ['--line', String(l)] : []), ...(l && c ? ['--column', String(c)] : []), absPath]
  return { type: 'cli', command: editor.command, args, macApp: editor.macApp }
}

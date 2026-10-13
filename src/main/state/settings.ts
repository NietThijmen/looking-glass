import { app, nativeTheme } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MenuCommand } from '../../shared/ipc'
import {
  COMMANDS,
  DEFAULT_SETTINGS,
  isValidAccelerator,
  type ThemeSetting,
  type UserSettings,
} from '../../shared/settings'

const file = (): string => path.join(app.getPath('userData'), 'settings.json')
const THEMES: ThemeSetting[] = ['dark', 'light', 'system']

let current: UserSettings = DEFAULT_SETTINGS

/** Settings with unknown or invalid values dropped. */
export function sanitizeSettings(raw: unknown): UserSettings {
  const value = (raw ?? {}) as Partial<UserSettings>
  const keybindings: UserSettings['keybindings'] = {}
  const known = new Set<string>(COMMANDS.map((c) => c.command))
  for (const [command, key] of Object.entries(value.keybindings ?? {})) {
    if (known.has(command) && typeof key === 'string' && isValidAccelerator(key))
      keybindings[command as MenuCommand] = key
  }
  return {
    theme: THEMES.includes(value.theme as ThemeSetting)
      ? (value.theme as ThemeSetting)
      : DEFAULT_SETTINGS.theme,
    keybindings,
  }
}

export function settings(): UserSettings {
  return current
}

export async function loadSettings(): Promise<UserSettings> {
  try {
    current = sanitizeSettings(JSON.parse(await fs.readFile(file(), 'utf8')))
  } catch {
    current = DEFAULT_SETTINGS
  }
  applyTheme(current.theme)
  return current
}

export async function saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  current = sanitizeSettings({ ...current, ...patch })
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(current, null, 2))
  applyTheme(current.theme)
  return current
}

/** The renderer, @pierre/diffs and the terminal all follow `prefers-color-scheme`. */
function applyTheme(theme: ThemeSetting): void {
  nativeTheme.themeSource = theme
}

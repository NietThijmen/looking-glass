import { create } from 'zustand'
import type { MenuCommand } from '@lookingglass/shared/ipc'
import { DEFAULT_SETTINGS, formatAccelerator, keyFor, type UserSettings } from '@lookingglass/shared/settings'

interface SettingsStore {
  settings: UserSettings
  load(): Promise<void>
  set(patch: Partial<UserSettings>): Promise<void>
  /** Main saved new settings (from this window or another source). */
  apply(settings: UserSettings): void
}

export const useSettings = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  load: async () => set({ settings: await window.lookingglass.settings.get() }),
  set: async (patch) => set({ settings: await window.lookingglass.settings.set(patch) }),
  apply: (settings) => set({ settings }),
}))

const isMac = navigator.userAgent.includes('Mac')

/** The current shortcut for a menu command, formatted for display (follows Settings). */
export function useShortcut(command: MenuCommand): string {
  return useSettings((s) => formatAccelerator(keyFor(s.settings, command), isMac))
}

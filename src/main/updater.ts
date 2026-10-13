import { app, dialog, type MenuItemConstructorOptions } from 'electron'
import electronUpdater from 'electron-updater'
import { isSmokeTest } from './env'

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Only packaged, non-smoke builds update themselves (from GitHub releases, see electron-builder.yml). */
export const updatesEnabled = (): boolean => app.isPackaged && !isSmokeTest

/**
 * Check for a new release now and every few hours. electron-updater downloads it in
 * the background and installs it on quit; macOS only accepts signed updates.
 */
export function startAutoUpdates(): void {
  if (!updatesEnabled()) return
  autoUpdater.logger = {
    info: () => undefined,
    warn: console.warn,
    error: console.error,
    debug: () => undefined,
  }
  autoUpdater.on('error', (error) => console.warn('[updates]', error.message))
  const check = (): void => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  check()
  setInterval(check, CHECK_EVERY_MS).unref()
}

async function checkNow(): Promise<void> {
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.updateInfo.version
    const message =
      result?.isUpdateAvailable && latest
        ? `Version ${latest} is downloading and will be installed when you quit Lookingglass.`
        : `You're on the latest version (${app.getVersion()}).`
    await dialog.showMessageBox({ type: 'info', message: 'Lookingglass updates', detail: message })
  } catch (error) {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'Could not check for updates',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/** "Check for Updates…" for the app menu, in builds that can update. */
export function updateMenuItems(): MenuItemConstructorOptions[] {
  return updatesEnabled() ? [{ label: 'Check for Updates…', click: () => void checkNow() }] : []
}

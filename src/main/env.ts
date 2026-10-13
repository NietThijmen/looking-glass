import { fileURLToPath } from 'node:url'

/** Set by electron-vite in `dev` to the renderer dev server URL. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL']

export const isDev = devServerUrl !== undefined

/** Packaged/production builds serve the renderer from this custom scheme. */
export const APP_SCHEME = 'app'
export const APP_HOST = 'lookingglass'

/** The URL the main window loads. */
export const rendererEntryUrl = devServerUrl ?? `${APP_SCHEME}://${APP_HOST}/index.html`

/** The only origin allowed to call IPC handlers and to be navigated to. */
export const rendererOrigin = devServerUrl ? new URL(devServerUrl).origin : `${APP_SCHEME}://${APP_HOST}`

export const rendererDir = fileURLToPath(new URL('../renderer', import.meta.url))
export const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))

/** `LOOKINGGLASS_SMOKE=1` launches, self-checks, and exits. Used by CI and packaging checks. */
export const isSmokeTest = process.env['LOOKINGGLASS_SMOKE'] === '1'

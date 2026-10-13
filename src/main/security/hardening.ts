import { app, session } from 'electron'
import { browserSession, hardenBrowserSession } from '../browser/BrowserService'
import { isDev, rendererOrigin } from '../env'
import { developmentCsp } from './csp'
import { hasOrigin } from './paths'

/**
 * App-wide defaults from Electron's security checklist. Later features that
 * need exceptions (the embedded browser in Phase 4) get their own session
 * partition with their own rules instead of loosening these.
 */
export function applyHardening(): void {
  const ses = session.defaultSession

  // Camera, mic, notifications, geolocation, …: nothing in the app UI needs them.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  hardenBrowserSession()

  // Production CSP is set by the app:// protocol handler; the dev server needs it injected.
  if (isDev) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      if (!hasOrigin(details.url, rendererOrigin)) return callback({})
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [developmentCsp],
        },
      })
    })
  }

  const browser = browserSession()
  app.on('web-contents-created', (_event, contents) => {
    // Browser tabs are allowed to navigate anywhere; BrowserService sets their rules.
    if (contents.session === browser) return
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!hasOrigin(url, rendererOrigin)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!hasOrigin(url, rendererOrigin)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_HOST, APP_SCHEME } from '../env'
import { productionCsp } from './csp'
import { resolveInside } from '@lookingglass/workspace/paths'

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ])
}

/** Serve the built renderer from `app://lookingglass/…`, confined to `rendererDir`. */
export function serveRenderer(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })

    const filePath = resolveInside(rendererDir, url.pathname)
    if (!filePath) return new Response('Forbidden', { status: 403 })

    const file = await net.fetch(pathToFileURL(filePath).toString())
    if (!file.ok) return new Response('Not found', { status: 404 })

    const headers = new Headers(file.headers)
    headers.set('Content-Security-Policy', productionCsp)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(file.body, { status: file.status, headers })
  })
}

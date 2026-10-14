import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentDefinitions as load } from '@lookingglass/acp/registry'
import { isDev, isSmokeTest } from '../env'

/** Built-in agents plus `~/.lookingglass/agents.json`, with Electron's paths filled in. */
export function loadAgentDefinitions(): ReturnType<typeof load> {
  return load({
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    unpackedPath: (file) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
    nodeBootstrap: fileURLToPath(new URL('./nodeBootstrap.js', import.meta.url)),
    fakeAgent: fileURLToPath(new URL('./fakeAgent.js', import.meta.url)),
    includeFake: isDev || isSmokeTest,
  })
}

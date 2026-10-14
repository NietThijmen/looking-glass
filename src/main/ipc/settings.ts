import { agentsFile, readCustomAgents, writeCustomAgents } from '@lookingglass/acp/registry'
import { installMenu } from '../menu'
import { saveSettings, settings } from '../state/settings'
import { broadcast } from './broadcast'
import { handle } from './typed'

export function registerSettingsHandlers(): void {
  handle('settings:get', () => settings())
  handle('settings:set', async (_e, patch) => {
    const next = await saveSettings(patch)
    installMenu()
    broadcast('settings:changed', next)
    return next
  })
  handle('agents:readConfig', async () => ({ path: agentsFile(), ...(await readCustomAgents()) }))
  handle('agents:writeConfig', async (_e, agents) => {
    await writeCustomAgents(agents)
    broadcast('agents:changed', null)
  })
}

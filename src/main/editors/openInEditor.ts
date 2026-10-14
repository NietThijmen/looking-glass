import { shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { childEnv } from '@lookingglass/acp/childEnv'
import {
  editorLaunch,
  externalEditor,
  type EditorLaunch,
  type ExternalEditorId,
} from '@lookingglass/shared/editors'

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', env: childEnv() })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** macOS GUI apps get a minimal PATH, so also look inside the usual app bundle locations. */
function macLauncher(macApp: Extract<EditorLaunch, { type: 'cli' }>['macApp']): string | null {
  const home = process.env['HOME'] ?? ''
  for (const dir of ['/Applications', `${home}/Applications`]) {
    const candidate = `${dir}/${macApp.bundle}.app/Contents/MacOS/${macApp.executable}`
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** Open `absPath` in the chosen editor. Throws an error fit to show the user if that fails. */
export async function openInEditor(
  id: ExternalEditorId,
  absPath: string,
  line?: number,
  column?: number,
): Promise<void> {
  const editor = externalEditor(id)
  const launch = editorLaunch(id, absPath, line, column)
  try {
    if (launch.type === 'url') {
      await shell.openExternal(launch.url)
      return
    }
    try {
      await run(launch.command, launch.args)
    } catch (error) {
      const bundled = process.platform === 'darwin' ? macLauncher(launch.macApp) : null
      if (!bundled || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await run(bundled, launch.args)
    }
  } catch (error) {
    const hint =
      launch.type === 'url'
        ? `Is ${editor.label} installed?`
        : `Is ${editor.label} installed, with its command-line launcher "${launch.command}" on your PATH?`
    throw new Error(`Couldn't open ${editor.label}. ${hint} (${(error as Error).message})`, { cause: error })
  }
}

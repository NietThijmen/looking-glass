/**
 * Runs a Node script under Electron's Node (`ELECTRON_RUN_AS_NODE=1 electron
 * nodeBootstrap.js <script> ...args`), then drops `ELECTRON_RUN_AS_NODE` so the
 * script's own children (an agent's shell commands) get a normal Electron.
 * Separate entry point: must not import Electron.
 */
import { pathToFileURL } from 'node:url'

delete process.env['ELECTRON_RUN_AS_NODE']
const script = process.argv[2]
if (!script) throw new Error('nodeBootstrap: missing script path')
// The script sees its usual argv: [node, script, ...args].
process.argv.splice(1, 1)
await import(pathToFileURL(script).href)

import type { SessionNotification } from '@agentclientprotocol/sdk'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatus, PermissionRequest } from '../../shared/agent'
import { EditorState } from '../editor/EditorState'
import { PermissionService } from '../permissions/PermissionService'
import { WorkspaceService } from '../workspace/WorkspaceService'
import { AgentManager, sliceLines } from './AgentManager'
import type { AgentDefinition } from './definition'

// Node 24 runs the TypeScript fake agent directly (type stripping).
const fakeAgentPath = fileURLToPath(new URL('./fakeAgent.ts', import.meta.url))
const definition = (args: string[] = []): AgentDefinition => ({
  id: 'fake',
  label: 'Fake',
  command: process.execPath,
  args: [fakeAgentPath, ...args],
  builtIn: true,
})

let tmp: string
let manager: AgentManager
let updates: SessionNotification[]
let prompts: PermissionRequest[]
let statuses: AgentStatus[]
let editor: EditorState

async function setup(args: string[] = []) {
  const workspace = new WorkspaceService()
  await workspace.open(tmp)
  editor = new EditorState()
  updates = []
  prompts = []
  statuses = []
  const permissions = new PermissionService(
    (r) => prompts.push(r),
    () => undefined,
  )
  manager = new AgentManager({
    definitions: async () => [definition(args)],
    workspace,
    editor,
    permissions,
    mcp: () => null,
    onStatus: (_id, s) => statuses.push(s),
    onSessionUpdate: (n) => updates.push(n),
  })
  return { permissions }
}

async function newSession(): Promise<string> {
  const result = await manager.newSession('fake')
  if ('authRequired' in result) throw new Error('unexpected auth')
  return result.sessionId
}

const agentText = () =>
  updates
    .map((n) => n.update)
    .filter((u) => u.sessionUpdate === 'agent_message_chunk')
    .map((u) => (u.content.type === 'text' ? u.content.text : ''))
    .join('')

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lg-acp-')))
  await fs.writeFile(path.join(tmp, 'README.md'), 'on disk\nsecond line\n')
})

afterEach(async () => {
  manager?.disposeAll()
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('sliceLines', () => {
  it('slices 1-based line windows', () => {
    expect(sliceLines('a\nb\nc', 2, 1)).toBe('b')
    expect(sliceLines('a\nb\nc', 2)).toBe('b\nc')
    expect(sliceLines('a\nb\nc', null, 2)).toBe('a\nb')
    expect(sliceLines('a\nb\nc')).toBe('a\nb\nc')
  })
})

describe('AgentManager with the fake agent', () => {
  it('starts the agent, streams updates and ends the turn', async () => {
    await setup()
    const sessionId = await newSession()
    expect(statuses.at(-1)).toMatchObject({ state: 'ready', agentName: 'Fake agent' })

    const result = await manager.prompt(sessionId, [{ type: 'text', text: 'hello' }])
    expect(result).toEqual({ stopReason: 'end_turn' })
    const kinds = updates.map((n) => n.update.sessionUpdate)
    expect(kinds).toEqual(
      expect.arrayContaining(['agent_thought_chunk', 'plan', 'tool_call', 'agent_message_chunk']),
    )
    expect(agentText()).toContain('You said: **hello**')
  })

  it('serves fs/read_text_file from unsaved editor contents first', async () => {
    await setup()
    const sessionId = await newSession()
    await manager.prompt(sessionId, [{ type: 'text', text: 'read README.md' }])
    expect(agentText()).toContain('First line of `README.md`: on disk')

    updates.length = 0
    editor.update({
      openFiles: ['README.md'],
      activeFile: 'README.md',
      dirty: { 'README.md': 'unsaved!\nmore' },
    })
    await manager.prompt(sessionId, [{ type: 'text', text: 'read README.md' }])
    expect(agentText()).toContain('First line of `README.md`: unsaved!')
  })

  it('refuses reads outside the workspace', async () => {
    await setup()
    const sessionId = await newSession()
    await manager.prompt(sessionId, [{ type: 'text', text: 'read ../../etc/hosts' }])
    expect(agentText()).toMatch(/Could not read .*outside the workspace/)
  })

  it('routes permission requests to the user', async () => {
    const { permissions } = await setup()
    const sessionId = await newSession()
    const turn = manager.prompt(sessionId, [{ type: 'text', text: 'edit' }])
    await expect.poll(() => prompts.length).toBe(1)
    expect(prompts[0]!.toolCall.kind).toBe('edit')
    permissions.respond(prompts[0]!.requestId, { optionId: 'reject' })
    await turn
    expect(agentText()).toContain('Permission outcome: reject')
  })

  it('cancels a running turn', async () => {
    await setup()
    const sessionId = await newSession()
    const turn = manager.prompt(sessionId, [{ type: 'text', text: 'slow' }])
    await expect.poll(() => agentText()).toContain('tick 2')
    await manager.cancel(sessionId)
    await expect(turn).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('reports auth_required and recovers after authenticate', async () => {
    await setup(['--require-auth'])
    const first = await manager.newSession('fake')
    expect(first).toMatchObject({ authRequired: true, methods: [{ id: 'fake-login' }] })
    await manager.authenticate('fake', 'fake-login')
    expect(await manager.newSession('fake')).toHaveProperty('sessionId')
  })
})

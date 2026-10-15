import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import type { NewSessionResult } from '@lookingglass/shared/agent'
import { SubagentService, type SubagentAgents } from './subagents'

const modelOption: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'claude-sonnet-5', name: 'Sonnet 5' },
  ],
}

function stub(configOptions: SessionConfigOption[] = [modelOption]) {
  const calls: string[] = []
  const agents: SubagentAgents = {
    list: async () => [{ id: 'claude-code', label: 'Claude Code', builtIn: true }],
    newSession: async (agentId) => {
      calls.push(`new ${agentId}`)
      return {
        sessionId: 's1',
        agentId,
        configOptions,
        promptCapabilities: {},
        canResume: false,
      } as NewSessionResult
    },
    setConfigOption: async (sessionId, configId, value) => {
      calls.push(`set ${configId}=${value}`)
      return []
    },
    prompt: async (sessionId, prompt) => {
      calls.push(`prompt ${prompt.map((b) => (b.type === 'text' ? b.text : '')).join(' | ')}`)
      service.handleUpdate({
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
      })
      return { stopReason: 'end_turn' }
    },
    cancel: async () => undefined,
  }
  const service = new SubagentService({
    agents,
    settings: async () => ({
      enabled: true,
      targets: { coder: '@claude/claude-sonnet-5', plain: 'claude-code' },
      defaultTarget: 'coder',
      timeoutSeconds: 600,
    }),
  })
  return { service, calls }
}

describe('SubagentService', () => {
  it('runs the default target on its model and returns the reply', async () => {
    const { service, calls } = stub()
    const result = await service.execute('parent', { role: 'Reviewer', prompt: 'look' })
    expect(result).toMatchObject({
      target: 'coder',
      agentId: 'claude-code',
      model: 'claude-sonnet-5',
      text: 'done',
    })
    expect(calls).toEqual([
      'new claude-code',
      'set model=claude-sonnet-5',
      'prompt You are acting as: Reviewer. | look',
    ])
  })

  it('accepts an @agent/model target directly and matches models by name', async () => {
    const { service, calls } = stub()
    await service.execute('parent', { target: '@claude/sonnet 5', prompt: 'x' })
    expect(calls).toContain('set model=claude-sonnet-5')
  })

  it('leaves the model alone without one', async () => {
    const { service, calls } = stub()
    await service.execute('parent', { target: 'plain', prompt: 'x' })
    expect(calls.some((c) => c.startsWith('set'))).toBe(false)
  })

  it('lists the available models when the model is unknown', async () => {
    const { service } = stub()
    await expect(service.execute('parent', { target: '@claude/gpt-9', prompt: 'x' })).rejects.toThrow(
      'Available: default, claude-sonnet-5',
    )
  })

  it('refuses unknown targets and unconfigured agents', async () => {
    const { service } = stub()
    await expect(service.execute('parent', { target: 'nope', prompt: 'x' })).rejects.toThrow('Unknown target')
    await expect(service.execute('parent', { target: '@codex/gpt', prompt: 'x' })).rejects.toThrow(
      "isn't configured",
    )
  })
})

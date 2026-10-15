import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import type { NewSessionResult } from '@lookingglass/shared/agent'
import { parseAgentRef, parseSubagentSettings, SubagentService, type SubagentAgents } from './subagents'

describe('parseAgentRef', () => {
  it('splits agent and model at the first slash', () => {
    expect(parseAgentRef('@codex/gpt-5.5-astra')).toEqual({ agentId: 'codex', model: 'gpt-5.5-astra' })
    expect(parseAgentRef('@router/deepseek/coder')).toEqual({ agentId: 'router', model: 'deepseek/coder' })
  })

  it('maps @claude to the built-in agent and allows no model', () => {
    expect(parseAgentRef('@claude/claude-sonnet-5')).toEqual({
      agentId: 'claude-code',
      model: 'claude-sonnet-5',
    })
    expect(parseAgentRef('@deepseek-coder')).toEqual({ agentId: 'deepseek-coder', model: null })
    expect(parseAgentRef('claude-code')).toEqual({ agentId: 'claude-code', model: null })
  })

  it('rejects empty parts', () => {
    expect(parseAgentRef('@')).toBeNull()
    expect(parseAgentRef('@codex/')).toBeNull()
    expect(parseAgentRef('@/gpt')).toBeNull()
  })
})

describe('parseSubagentSettings', () => {
  it('reads targets and drops invalid ones', () => {
    expect(
      parseSubagentSettings({
        subagents: {
          enabled: true,
          targets: { coder: '@claude/claude-sonnet-5', bad: '@codex/', num: 3 },
          defaultTarget: 'coder',
        },
      }),
    ).toEqual({
      enabled: true,
      targets: { coder: '@claude/claude-sonnet-5' },
      defaultTarget: 'coder',
      timeoutSeconds: 600,
    })
  })

  it('ignores a defaultTarget that is not a target, and missing sections', () => {
    expect(parseSubagentSettings({ subagents: { targets: {}, defaultTarget: 'x' } })).toMatchObject({
      enabled: false,
      defaultTarget: null,
    })
    expect(parseSubagentSettings({})).toBeNull()
  })
})

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
    capabilities: async () => ({}),
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

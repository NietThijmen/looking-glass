import { describe, expect, it } from 'vitest'
import { parseAgentRef, parseSubagentSettings } from './subagentConfig'

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
    expect(parseSubagentSettings(null)).toBeNull()
    expect(parseSubagentSettings({ subagents: 'on' })).toBeNull()
  })

  it('falls back to defaults for fields of the wrong type', () => {
    expect(
      parseSubagentSettings({
        subagents: { enabled: 'yes', targets: [], defaultTarget: 3, timeoutSeconds: -1 },
      }),
    ).toEqual({ enabled: false, targets: {}, defaultTarget: null, timeoutSeconds: 600 })
    expect(parseSubagentSettings({ subagents: { timeoutSeconds: 30 } })).toMatchObject({ timeoutSeconds: 30 })
  })
})

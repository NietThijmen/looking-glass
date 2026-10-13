import { describe, expect, it } from 'vitest'
import { applyUpdate, userItem, type TranscriptItem } from './transcript'

const text = (t: string) => ({ type: 'text' as const, text: t })
const strip = (items: TranscriptItem[]) => items.map(({ id: _, ...rest }) => rest)

describe('applyUpdate', () => {
  it('merges consecutive chunks of the same kind', () => {
    let items: TranscriptItem[] = []
    items = applyUpdate(items, { sessionUpdate: 'agent_thought_chunk', content: text('hmm ') })
    items = applyUpdate(items, { sessionUpdate: 'agent_thought_chunk', content: text('ok') })
    items = applyUpdate(items, { sessionUpdate: 'agent_message_chunk', content: text('Hel') })
    items = applyUpdate(items, { sessionUpdate: 'agent_message_chunk', content: text('lo') })
    expect(strip(items)).toEqual([
      { kind: 'thought', text: 'hmm ok' },
      { kind: 'agent', text: 'Hello' },
    ])
  })

  it('creates tool calls and patches them with partial updates', () => {
    let items: TranscriptItem[] = []
    items = applyUpdate(items, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read file',
      kind: 'read',
      status: 'pending',
      locations: [{ path: '/w/a.ts' }],
    })
    items = applyUpdate(items, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    expect(strip(items)).toEqual([
      {
        kind: 'tool',
        call: {
          toolCallId: 't1',
          title: 'Read file',
          kind: 'read',
          status: 'completed',
          content: [],
          locations: [{ path: '/w/a.ts' }],
        },
      },
    ])
  })

  it('handles an update for a tool call it has not seen', () => {
    const items = applyUpdate([], { sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'failed' })
    expect(items[0]).toMatchObject({ kind: 'tool', call: { toolCallId: 'x', status: 'failed' } })
  })

  it('keeps one plan per turn and replaces it', () => {
    const entry = (content: string) => ({ content, priority: 'medium' as const, status: 'pending' as const })
    let items: TranscriptItem[] = [userItem('first', [])]
    items = applyUpdate(items, { sessionUpdate: 'plan', entries: [entry('a')] })
    items = applyUpdate(items, { sessionUpdate: 'agent_message_chunk', content: text('working') })
    items = applyUpdate(items, { sessionUpdate: 'plan', entries: [entry('a'), entry('b')] })
    expect(items.filter((i) => i.kind === 'plan')).toHaveLength(1)
    expect(items[1]).toMatchObject({ kind: 'plan', plan: { entries: [{ content: 'a' }, { content: 'b' }] } })

    items = [...items, userItem('second', [])]
    items = applyUpdate(items, { sessionUpdate: 'plan', entries: [entry('c')] })
    expect(items.filter((i) => i.kind === 'plan')).toHaveLength(2)
  })

  it('ignores updates it does not render', () => {
    const items: TranscriptItem[] = []
    expect(applyUpdate(items, { sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toBe(items)
  })
})

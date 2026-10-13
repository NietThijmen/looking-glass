import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchLayout } from './workbenchState'

describe('normalizeWorkbenchLayout', () => {
  it('clamps widths and fixes invalid column order', () => {
    const layout = normalizeWorkbenchLayout({
      agentWidth: 50,
      browserWidth: 10_000,
      columnOrder: ['editor', 'editor', 'browser'],
    })
    expect(layout.agentWidth).toBe(280)
    expect(layout.browserWidth).toBe(900)
    expect(layout.columnOrder).toEqual(['editor', 'agent', 'browser'])
  })
})

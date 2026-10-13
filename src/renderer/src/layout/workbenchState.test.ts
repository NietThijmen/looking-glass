import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchLayout } from './workbenchState'

describe('normalizeWorkbenchLayout', () => {
  it('clamps sizes and defaults missing fields', () => {
    const layout = normalizeWorkbenchLayout({ sidebarWidth: 50, terminalHeight: 10_000 })
    expect(layout.sidebarWidth).toBe(180)
    expect(layout.terminalHeight).toBe(600)
    expect(layout.sidebarOpen).toBe(true)
  })

  it('drops the old per-column layout', () => {
    const layout = normalizeWorkbenchLayout({ agentWidth: 400, columnOrder: ['agent'] } as never)
    expect(layout).toEqual({ sidebarWidth: 256, sidebarOpen: true, terminalHeight: 256 })
  })
})

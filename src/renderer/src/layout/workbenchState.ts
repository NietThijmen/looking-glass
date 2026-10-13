export type WorkbenchColumn = 'editor' | 'agent' | 'browser'

export interface WorkbenchLayout {
  columnOrder: WorkbenchColumn[]
  agentWidth: number
  browserWidth: number
  sidebarWidth: number
  sidebarOpen: boolean
  terminalHeight: number
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  columnOrder: ['editor', 'agent', 'browser'],
  agentWidth: 384,
  browserWidth: 420,
  sidebarWidth: 256,
  sidebarOpen: true,
  terminalHeight: 256,
}

const STORAGE_KEY = 'lookingglass.workbench.v1'

export const LAYOUT_LIMITS = {
  sidebar: { min: 180, max: 480 },
  agent: { min: 280, max: 720 },
  browser: { min: 320, max: 900 },
  terminal: { min: 120, max: 600 },
  editor: { min: 240 },
} as const

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeWorkbenchLayout(raw: Partial<WorkbenchLayout> | null | undefined): WorkbenchLayout {
  const base = DEFAULT_WORKBENCH_LAYOUT
  const order = raw?.columnOrder?.filter(
    (c): c is WorkbenchColumn => c === 'editor' || c === 'agent' || c === 'browser',
  )
  const columnOrder = order && order.length === 3 && new Set(order).size === 3 ? order : [...base.columnOrder]
  return {
    columnOrder,
    agentWidth: clamp(raw?.agentWidth ?? base.agentWidth, LAYOUT_LIMITS.agent.min, LAYOUT_LIMITS.agent.max),
    browserWidth: clamp(
      raw?.browserWidth ?? base.browserWidth,
      LAYOUT_LIMITS.browser.min,
      LAYOUT_LIMITS.browser.max,
    ),
    sidebarWidth: clamp(
      raw?.sidebarWidth ?? base.sidebarWidth,
      LAYOUT_LIMITS.sidebar.min,
      LAYOUT_LIMITS.sidebar.max,
    ),
    sidebarOpen: raw?.sidebarOpen ?? base.sidebarOpen,
    terminalHeight: clamp(
      raw?.terminalHeight ?? base.terminalHeight,
      LAYOUT_LIMITS.terminal.min,
      LAYOUT_LIMITS.terminal.max,
    ),
  }
}

export function loadWorkbenchLayout(): WorkbenchLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<WorkbenchLayout> | null
    return normalizeWorkbenchLayout(raw)
  } catch {
    return { ...DEFAULT_WORKBENCH_LAYOUT }
  }
}

export function saveWorkbenchLayout(layout: WorkbenchLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Private mode or quota — layout still works for this session.
  }
}

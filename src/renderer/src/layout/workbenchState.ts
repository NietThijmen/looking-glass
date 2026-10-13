export interface WorkbenchLayout {
  sidebarWidth: number
  sidebarOpen: boolean
  terminalHeight: number
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  sidebarWidth: 256,
  sidebarOpen: true,
  terminalHeight: 256,
}

const STORAGE_KEY = 'lookingglass.workbench.v1'

export const LAYOUT_LIMITS = {
  sidebar: { min: 180, max: 640 },
  terminal: { min: 120, max: 600 },
} as const

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeWorkbenchLayout(raw: Partial<WorkbenchLayout> | null | undefined): WorkbenchLayout {
  const base = DEFAULT_WORKBENCH_LAYOUT
  return {
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

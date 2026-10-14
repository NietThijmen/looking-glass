/** Zero-based, like LSP and the editor. */
export interface DiagnosticRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface Diagnostic {
  range: DiagnosticRange
  severity: DiagnosticSeverity
  message: string
  source?: string
  code?: string | number
}

/** Diagnostics by workspace-relative path. Files without problems are left out. */
export type DiagnosticsByPath = Record<string, Diagnostic[]>

/** Plain-text problem list with 1-based positions, for agents (`@problems`, MCP). */
export function formatDiagnostics(byPath: DiagnosticsByPath): string {
  const lines: string[] = []
  for (const [path, list] of Object.entries(byPath).sort(([a], [b]) => a.localeCompare(b))) {
    for (const d of list) {
      const where = `${path}:${d.range.start.line + 1}:${d.range.start.character + 1}`
      const tag = [d.source, d.code].filter((v) => v !== undefined && v !== '').join(' ')
      lines.push(`${where} ${d.severity}${tag ? ` (${tag})` : ''}: ${d.message}`)
    }
  }
  return lines.length ? lines.join('\n') : 'No problems.'
}

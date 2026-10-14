import type { AgentSummary } from '@lookingglass/shared/agent'

export interface AgentDefinition {
  id: string
  label: string
  command: string
  args: string[]
  env?: Record<string, string>
  builtIn: boolean
}

export function summarize(definition: AgentDefinition): AgentSummary {
  return { id: definition.id, label: definition.label, builtIn: definition.builtIn }
}

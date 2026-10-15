export { AcpClient, type AcpClientHost, type AgentProcessSpec } from './AcpClient'
export { AgentManager, CALLER_HEADER, sliceLines, type AgentManagerDeps } from './AgentManager'
export { summarize, type AgentDefinition } from './definition'
export type { EditorBuffers, FileHost, McpHost, ReviewHost, TerminalHost } from './hosts'
export { DEFAULT_POLICY, PermissionService, type PermissionPolicy } from './PermissionService'
export {
  parseAgentRef,
  parseSubagentSettings,
  readWorkspaceSubagentSettings,
  SubagentService,
  type AgentRef,
  type SubagentResult,
  type SubagentSettings,
  type SubagentTarget,
} from './subagents'

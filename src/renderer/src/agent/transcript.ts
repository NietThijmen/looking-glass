import type {
  ContentBlock,
  PlanEntry,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from '@agentclientprotocol/sdk'

export interface ToolCallState {
  toolCallId: string
  title: string
  kind?: ToolKind
  status?: ToolCallStatus
  content: ToolCallContent[]
  locations: ToolCallLocation[]
  rawInput?: unknown
}

export type PlanState =
  | { type: 'entries'; entries: PlanEntry[] }
  | { type: 'markdown'; content: string }
  | { type: 'file'; uri: string }

export type TranscriptItem =
  | { kind: 'user'; id: number; text: string; attachments: string[]; checkpoint?: string | null }
  | { kind: 'agent'; id: number; text: string }
  | { kind: 'thought'; id: number; text: string }
  | { kind: 'tool'; id: number; call: ToolCallState }
  | { kind: 'plan'; id: number; planId: string | null; plan: PlanState }
  | { kind: 'notice'; id: number; severity: string; text: string }
  | { kind: 'turn-end'; id: number; reason: string; error?: string }

let nextId = 1
const id = (): number => nextId++

export function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'image':
      return '[image]'
    case 'audio':
      return '[audio]'
    case 'resource_link':
      return `[${block.name}](${block.uri})`
    case 'resource':
      return 'text' in block.resource ? block.resource.text : `[${block.resource.uri}]`
    default:
      return ''
  }
}

function appendChunk(items: TranscriptItem[], kind: 'agent' | 'thought', text: string): TranscriptItem[] {
  const last = items.at(-1)
  if (last?.kind === kind) return [...items.slice(0, -1), { ...last, text: last.text + text }]
  return [...items, { kind, id: id(), text }]
}

function mergeToolCall(
  items: TranscriptItem[],
  toolCallId: string,
  patch: Partial<ToolCallState>,
): TranscriptItem[] {
  const index = items.findIndex((i) => i.kind === 'tool' && i.call.toolCallId === toolCallId)
  if (index === -1) {
    const call: ToolCallState = { toolCallId, title: 'Tool call', content: [], locations: [], ...patch }
    return [...items, { kind: 'tool', id: id(), call }]
  }
  const existing = items[index] as Extract<TranscriptItem, { kind: 'tool' }>
  const next = [...items]
  next[index] = { ...existing, call: { ...existing.call, ...patch } }
  return next
}

/** Only fields the agent actually sent; ACP updates are partial. */
function definedFields<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>
}

function upsertPlan(items: TranscriptItem[], planId: string | null, plan: PlanState): TranscriptItem[] {
  // One plan per turn (plans after the latest user message), or per planId when given.
  const lastUser = items.findLastIndex((i) => i.kind === 'user')
  const index = items.findLastIndex(
    (i, n) => i.kind === 'plan' && (planId !== null ? i.planId === planId : n > lastUser),
  )
  if (index === -1) return [...items, { kind: 'plan', id: id(), planId, plan }]
  const next = [...items]
  next[index] = { ...(items[index] as Extract<TranscriptItem, { kind: 'plan' }>), plan }
  return next
}

/** Fold one `session/update` into the transcript. Pure, so it is easy to test. */
export function applyUpdate(items: TranscriptItem[], update: SessionUpdate): TranscriptItem[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return appendChunk(items, 'agent', blockText(update.content))
    case 'agent_thought_chunk':
      return appendChunk(items, 'thought', blockText(update.content))
    case 'user_message_chunk': {
      // Agents echo user messages when replaying a loaded session.
      const last = items.at(-1)
      const text = blockText(update.content)
      if (last?.kind === 'user') return [...items.slice(0, -1), { ...last, text: last.text + text }]
      return [...items, { kind: 'user', id: id(), text, attachments: [] }]
    }
    case 'tool_call': {
      const { sessionUpdate: _, toolCallId, ...rest } = update
      return mergeToolCall(items, toolCallId, {
        ...definedFields(rest),
        content: update.content ?? [],
        locations: update.locations ?? [],
      } as Partial<ToolCallState>)
    }
    case 'tool_call_update': {
      const { sessionUpdate: _, toolCallId, ...rest } = update
      return mergeToolCall(items, toolCallId, definedFields(rest) as Partial<ToolCallState>)
    }
    case 'plan':
      return upsertPlan(items, null, { type: 'entries', entries: update.entries })
    case 'plan_update': {
      const plan = update.plan
      const state: PlanState =
        plan.type === 'items'
          ? { type: 'entries', entries: plan.entries }
          : plan.type === 'markdown'
            ? { type: 'markdown', content: plan.content }
            : { type: 'file', uri: plan.uri }
      return upsertPlan(items, plan.planId, state)
    }
    case 'plan_removed':
      return items.filter((i) => !(i.kind === 'plan' && i.planId === update.planId))
    case 'notice':
      return [
        ...items,
        {
          kind: 'notice',
          id: id(),
          severity: update.severity,
          text: [update.title, update.description].filter(Boolean).join(': '),
        },
      ]
    default:
      return items
  }
}

export function userItem(text: string, attachments: string[]): TranscriptItem {
  return { kind: 'user', id: id(), text, attachments }
}

export function notice(text: string, severity = 'info'): TranscriptItem {
  return { kind: 'notice', id: id(), severity, text }
}

export function turnEnd(reason: string, error?: string): TranscriptItem {
  return { kind: 'turn-end', id: id(), reason, ...(error ? { error } : {}) }
}

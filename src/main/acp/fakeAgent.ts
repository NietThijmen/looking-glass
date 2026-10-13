/**
 * A scriptable ACP agent for tests and smoke runs. Runs as its own process
 * (`ELECTRON_RUN_AS_NODE=1 electron out/main/fakeAgent.js`) and must stay
 * self-contained: it only imports the ACP SDK and Node built-ins.
 *
 * The prompt text picks the behaviour:
 *   "read <path>"  → fs/read_text_file on <path> (relative to the session cwd) and quote line 1
 *   "edit"         → session/request_permission for an edit, report the choice
 *   "write <path> <text>" → fs/write_text_file <text> (\n escapes allowed) to <path>, reported with a diff
 *   "touch <path> <text>" → write <path> directly with Node, like an agent using its own tools
 *   "run <command>" → terminal/create, wait for exit, report the output
 *   "slow"         → stream for a few seconds; honours session/cancel
 *   "auth"         → fail session/new with auth_required until `authenticate` was called
 *   anything else  → thought, plan, a tool call, then echo the prompt as markdown
 */
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentContext,
  type ContentBlock,
  type PermissionOption,
  type SessionUpdate,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

interface Session {
  cwd: string
  abort: AbortController | null
}

const sessions = new Map<string, Session>()
let authenticated = !process.argv.includes('--require-auth')

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    })
  })

function promptText(prompt: ContentBlock[]): string {
  return prompt
    .map((b) =>
      b.type === 'text'
        ? b.text
        : b.type === 'resource_link'
          ? `@${b.name}`
          : b.type === 'resource'
            ? `@${path.basename(decodeURI(b.resource.uri.replace(/#.*$/, '')))}`
            : b.type === 'image'
              ? '@image'
              : '',
    )
    .join(' ')
    .trim()
}

async function turn(
  cx: AgentContext,
  sessionId: string,
  session: Session,
  text: string,
  signal: AbortSignal,
) {
  const send = (update: SessionUpdate) => cx.notify(methods.client.session.update, { sessionId, update })
  const say = (t: string) =>
    send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } })

  const read = /^read\s+(\S+)/i.exec(text)
  if (read) {
    const target = path.resolve(session.cwd, read[1]!)
    await send({
      sessionUpdate: 'tool_call',
      toolCallId: 'read-1',
      title: `Read ${read[1]}`,
      kind: 'read',
      status: 'in_progress',
      locations: [{ path: target }],
    })
    try {
      const { content } = await cx.request(methods.client.fs.readTextFile, {
        sessionId,
        path: target,
        line: 1,
        limit: 1,
      })
      await send({ sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed' })
      await say(`First line of \`${read[1]}\`: ${content}`)
    } catch (error) {
      await send({ sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'failed' })
      await say(`Could not read ${read[1]}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }

  const write = /^(write|touch)\s+(\S+)\s+([\s\S]*)$/i.exec(text)
  if (write) {
    const [, how, rel, raw] = write
    const target = path.resolve(session.cwd, rel!)
    const content = raw!.replace(/\\n/g, '\n')
    if (how!.toLowerCase() === 'touch') {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    } else {
      await cx.request(methods.client.fs.writeTextFile, { sessionId, path: target, content })
    }
    await send({
      sessionUpdate: 'tool_call',
      toolCallId: `write-${rel}`,
      title: `Write ${rel}`,
      kind: 'edit',
      status: 'completed',
      locations: [{ path: target }],
      content: [{ type: 'diff', path: target, newText: content }],
    })
    await say(`Wrote ${rel}`)
    return
  }

  const run = /^run\s+(.+)$/i.exec(text)
  if (run) {
    const { terminalId } = await cx.request(methods.client.terminal.create, {
      sessionId,
      command: run[1]!,
      cwd: session.cwd,
    })
    await send({
      sessionUpdate: 'tool_call',
      toolCallId: `run-${terminalId}`,
      title: `Run ${run[1]}`,
      kind: 'execute',
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId }],
    })
    const exit = await cx.request(methods.client.terminal.waitForExit, { sessionId, terminalId })
    const { output } = await cx.request(methods.client.terminal.output, { sessionId, terminalId })
    await cx.request(methods.client.terminal.release, { sessionId, terminalId })
    await send({ sessionUpdate: 'tool_call_update', toolCallId: `run-${terminalId}`, status: 'completed' })
    await say(`Exit ${exit.exitCode}. Output: ${output.trim()}`)
    return
  }

  if (/^edit\b/i.test(text)) {
    const toolCall: ToolCallUpdate = { toolCallId: 'edit-1', title: 'Edit src/app.ts', kind: 'edit' }
    const options: PermissionOption[] = [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ]
    await send({
      sessionUpdate: 'tool_call',
      toolCallId: 'edit-1',
      title: 'Edit src/app.ts',
      kind: 'edit',
      status: 'pending',
    })
    const { outcome } = await cx.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall,
      options,
    })
    const choice = outcome.outcome === 'selected' ? outcome.optionId : 'cancelled'
    await send({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: choice === 'allow' ? 'completed' : 'failed',
    })
    await say(`Permission outcome: ${choice}`)
    return
  }

  if (/^slow\b/i.test(text)) {
    for (let i = 1; i <= 30; i++) {
      await sleep(100, signal)
      await say(`tick ${i} `)
    }
    return
  }

  await send({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Considering the request…' },
  })
  await send({
    sessionUpdate: 'plan',
    entries: [
      { content: 'Understand the request', priority: 'high', status: 'completed' },
      { content: 'Answer it', priority: 'medium', status: 'in_progress' },
    ],
  })
  await send({
    sessionUpdate: 'tool_call',
    toolCallId: 'search-1',
    title: 'Search the workspace',
    kind: 'search',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: '3 matches' } }],
  })
  for (const chunk of [
    'You said: **',
    text || '(nothing)',
    '**\n\n```ts\nconst echoed = ',
    JSON.stringify(text),
    '\n```\n',
  ]) {
    await say(chunk)
  }
}

const app = agent({ name: 'fake-agent' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, promptCapabilities: { embeddedContext: true } },
    agentInfo: { name: 'fake-agent', title: 'Fake agent', version: '1.0.0' },
    authMethods: [{ id: 'fake-login', name: 'Fake login', description: 'Always succeeds' }],
  }))
  .onRequest(methods.agent.authenticate, () => {
    authenticated = true
    return {}
  })
  .onRequest(methods.agent.session.new, (ctx) => {
    if (!authenticated) throw RequestError.authRequired(undefined, 'Log in to the fake agent first')
    const sessionId = randomUUID()
    sessions.set(sessionId, { cwd: ctx.params.cwd, abort: null })
    return { sessionId }
  })
  .onNotification(methods.agent.session.cancel, (ctx) => {
    sessions.get(ctx.params.sessionId)?.abort?.abort()
  })
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    const session = sessions.get(ctx.params.sessionId)
    if (!session) throw RequestError.invalidParams(undefined, 'Unknown session')
    session.abort?.abort()
    const abort = new AbortController()
    session.abort = abort
    try {
      await turn(ctx.client, ctx.params.sessionId, session, promptText(ctx.params.prompt), abort.signal)
      return { stopReason: 'end_turn' as const }
    } catch (error) {
      if (abort.signal.aborted) return { stopReason: 'cancelled' as const }
      throw error
    } finally {
      if (session.abort === abort) session.abort = null
    }
  })

const connection = app.connect(
  ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
)
void connection.closed.then(() => process.exit(0))

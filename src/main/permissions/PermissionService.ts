import type { RequestPermissionRequest, RequestPermissionResponse, ToolKind } from '@agentclientprotocol/sdk'
import type { PermissionReply, PermissionRequest } from '../../shared/agent'

export interface PermissionPolicy {
  /** Tool kinds answered with the agent's "allow once" option without asking. */
  autoAllow: ToolKind[]
}

/** Read-only kinds are safe to auto-approve; anything that edits, runs or fetches asks. */
export const DEFAULT_POLICY: PermissionPolicy = { autoAllow: ['read', 'search', 'think'] }

interface Pending {
  sessionId: string
  resolve(response: RequestPermissionResponse): void
}

/**
 * Answers `session/request_permission`: from policy when it can, otherwise by
 * asking the user through `prompt` and waiting for `respond`.
 */
export class PermissionService {
  #pending = new Map<string, Pending>()
  #nextId = 1

  constructor(
    private readonly prompt: (request: PermissionRequest) => void,
    private readonly resolved: (requestId: string) => void,
    private policy: PermissionPolicy = DEFAULT_POLICY,
  ) {}

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy
  }

  request(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const kind = params.toolCall.kind
    if (kind && this.policy.autoAllow.includes(kind)) {
      const allowOnce = params.options.find((o) => o.kind === 'allow_once')
      if (allowOnce)
        return Promise.resolve({ outcome: { outcome: 'selected', optionId: allowOnce.optionId } })
    }

    const requestId = `p${this.#nextId++}`
    return new Promise((resolve) => {
      this.#pending.set(requestId, { sessionId: params.sessionId, resolve })
      this.prompt({
        requestId,
        sessionId: params.sessionId,
        toolCall: params.toolCall,
        options: params.options,
      })
    })
  }

  respond(requestId: string, reply: PermissionReply): void {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    this.#pending.delete(requestId)
    pending.resolve(
      reply
        ? { outcome: { outcome: 'selected', optionId: reply.optionId } }
        : { outcome: { outcome: 'cancelled' } },
    )
    this.resolved(requestId)
  }

  /** Per the ACP spec, cancelling a turn answers its open permission requests with `cancelled`. */
  cancelSession(sessionId: string): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.sessionId === sessionId) this.respond(requestId, null)
    }
  }

  cancelAll(): void {
    for (const requestId of [...this.#pending.keys()]) this.respond(requestId, null)
  }
}

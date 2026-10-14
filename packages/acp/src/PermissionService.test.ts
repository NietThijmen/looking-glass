import type { PermissionOption, RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@lookingglass/shared/agent'
import { PermissionService } from './PermissionService'

const options: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
]

const request = (
  kind: RequestPermissionRequest['toolCall']['kind'],
  sessionId = 's1',
): RequestPermissionRequest => ({
  sessionId,
  toolCall: { toolCallId: 't1', title: 'Do a thing', kind },
  options,
})

function setup() {
  const prompts: PermissionRequest[] = []
  const resolved: string[] = []
  const service = new PermissionService(
    (r) => prompts.push(r),
    (id) => resolved.push(id),
  )
  return { service, prompts, resolved }
}

describe('PermissionService', () => {
  it('auto-allows read-only kinds with the allow_once option', async () => {
    const { service, prompts } = setup()
    await expect(service.request(request('read'))).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
    expect(prompts).toHaveLength(0)
  })

  it('asks for edits and resolves with the chosen option', async () => {
    const { service, prompts, resolved } = setup()
    const pending = service.request(request('edit'))
    expect(prompts).toHaveLength(1)
    service.respond(prompts[0]!.requestId, { optionId: 'always' })
    await expect(pending).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
    expect(resolved).toEqual([prompts[0]!.requestId])
  })

  it('treats a dismissed prompt as cancelled', async () => {
    const { service, prompts } = setup()
    const pending = service.request(request('execute'))
    service.respond(prompts[0]!.requestId, null)
    await expect(pending).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('cancels only the given session', async () => {
    const { service, prompts } = setup()
    const a = service.request(request('edit', 'a'))
    const b = service.request(request('edit', 'b'))
    service.cancelSession('a')
    await expect(a).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    service.respond(prompts[1]!.requestId, { optionId: 'allow' })
    await expect(b).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
  })

  it('asks when no allow_once option exists, even for reads', () => {
    const { service, prompts } = setup()
    void service.request({ ...request('read'), options: options.filter((o) => o.kind !== 'allow_once') })
    expect(prompts).toHaveLength(1)
  })
})

import type {
  PullRequestAction,
  PullRequestActionResult,
  PullRequestDetail,
} from '@lookingglass/shared/forge'
import type { ParsedRemote } from './remote'
import type { CommandRun } from './run'

export interface PullRequestQuery {
  cwd: string
  remote: ParsedRemote
  branch: string
  run: CommandRun
}

/**
 * One code host. `matches` is host-based, so a later forge (GitLab, or a self-hosted
 * host) decides for itself. Callers only read `PullRequestDetail`.
 */
export interface Forge {
  id: string
  matches(remote: ParsedRemote): boolean
  pullRequest(query: PullRequestQuery): Promise<PullRequestDetail | null>
  /** Acts on pull request `number`. Failures are a result, never a throw. */
  act(query: PullRequestQuery, number: number, action: PullRequestAction): Promise<PullRequestActionResult>
}

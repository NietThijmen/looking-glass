import type {
  PullRequestAction,
  PullRequestActionResult,
  PullRequestDetail,
  PullRequestSummary,
} from '@lookingglass/shared/forge'
import type { ParsedRemote } from './remote'

export interface PullRequestQuery {
  cwd: string
  remote: ParsedRemote
  branch: string
  /** GitHub API token, or null when none was found. */
  token: string | null
  /** HTTP client. Tests pass a fake; the app passes the global `fetch`. */
  fetch: typeof fetch
}

/**
 * One code host. `matches` is host-based, so a later forge (GitLab, or a self-hosted
 * host) decides for itself. Callers only read `PullRequestDetail`.
 */
export interface Forge {
  id: string
  matches(remote: ParsedRemote): boolean
  /** Open pull requests, newest first. Empty when the forge cannot be reached. */
  list(query: PullRequestQuery): Promise<PullRequestSummary[]>
  pullRequest(query: PullRequestQuery): Promise<PullRequestDetail | null>
  /** Acts on pull request `number`. Failures are a result, never a throw. */
  act(query: PullRequestQuery, number: number, action: PullRequestAction): Promise<PullRequestActionResult>
}

import { GithubForge } from './github'
import type { ParsedRemote } from './remote'
import type { Forge } from './types'

/** GitHub today. A later forge is a new file plus one entry in this list. */
const registry: readonly Forge[] = [GithubForge]

/** First registered forge whose host matches, or null when this app has no forge for it. */
export function forgeFor(remote: ParsedRemote): Forge | null {
  return registry.find((forge) => forge.matches(remote)) ?? null
}

import { app } from 'electron'
import { loadAppState, saveAppState } from './appState'

const MAX_RECENT = 10

let recent: string[] = []
const listeners: Array<() => void> = []

/** `root` moved to the front of `list`, without duplicates, capped at `max`. */
export function withRecent(list: string[], root: string, max = MAX_RECENT): string[] {
  return [root, ...list.filter((r) => r !== root)].slice(0, max)
}

/** Folders opened before, most recent first. */
export function recentWorkspaces(): string[] {
  return recent
}

/** Called after the list changes, so the menu can be rebuilt. */
export function onRecentWorkspacesChange(listener: () => void): void {
  listeners.push(listener)
}

export async function loadRecentWorkspaces(): Promise<void> {
  const saved = (await loadAppState()).recentWorkspaces
  recent = Array.isArray(saved) ? saved.filter((r) => typeof r === 'string').slice(0, MAX_RECENT) : []
}

async function update(next: string[]): Promise<void> {
  recent = next
  await saveAppState({ recentWorkspaces: next })
  for (const listener of listeners) listener()
}

export async function addRecentWorkspace(root: string): Promise<void> {
  app.addRecentDocument(root)
  await update(withRecent(recent, root))
}

export async function removeRecentWorkspace(root: string): Promise<void> {
  await update(recent.filter((r) => r !== root))
}

export async function clearRecentWorkspaces(): Promise<void> {
  app.clearRecentDocuments()
  await update([])
}

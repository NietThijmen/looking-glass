import { describe, expect, it } from 'vitest'
import { forgeFor } from './registry'
import { parseRemote } from './remote'

describe('parseRemote', () => {
  it('parses https remotes and strips the .git suffix', () => {
    expect(parseRemote('https://github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    })
    expect(parseRemote('https://github.com/owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    })
    expect(parseRemote('https://GitHub.com/Owner/Repo.git/')).toEqual({
      host: 'github.com',
      owner: 'Owner',
      repo: 'Repo',
    })
  })

  it('ignores credentials in an https remote', () => {
    expect(parseRemote('https://x-access-token:secret@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('parses scp-style ssh remotes', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    })
    expect(parseRemote('git@github.com:owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('parses a GitLab URL, which no registered forge claims', () => {
    const remote = parseRemote('https://gitlab.com/group/project.git')
    expect(remote).toEqual({ host: 'gitlab.com', owner: 'group', repo: 'project' })
    expect(forgeFor(remote!)).toBeNull()
  })

  it('returns null for text that is not a remote', () => {
    expect(parseRemote('not a remote')).toBeNull()
    expect(parseRemote('')).toBeNull()
  })
})

describe('forgeFor', () => {
  it('returns the GitHub forge only for github.com', () => {
    expect(forgeFor({ host: 'github.com', owner: 'owner', repo: 'repo' })?.id).toBe('github')
    expect(forgeFor({ host: 'gist.github.com', owner: 'owner', repo: 'repo' })).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))

const { withRecent } = await import('./recentWorkspaces')

describe('withRecent', () => {
  it('puts the newest folder first', () => {
    expect(withRecent(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('moves a reopened folder to the front without duplicating it', () => {
    expect(withRecent(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('drops the oldest folders past the limit', () => {
    expect(withRecent(['/a', '/b'], '/c', 2)).toEqual(['/c', '/a'])
  })
})

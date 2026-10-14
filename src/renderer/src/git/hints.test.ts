import { describe, expect, it } from 'vitest'
import { suggestedCommitMessage, visibleHints } from './hints'

describe('visibleHints', () => {
  it('hides every chip when the tree is clean and there is no pull request', () => {
    expect(visibleHints({ dirty: false, pullRequest: null })).toEqual({
      commit: false,
      commitAndPush: false,
      viewPr: false,
    })
  })

  it('shows the commit chips only when the tree is dirty', () => {
    expect(visibleHints({ dirty: true, pullRequest: null })).toEqual({
      commit: true,
      commitAndPush: true,
      viewPr: false,
    })
  })

  it('shows View PR only when a pull request is open', () => {
    expect(visibleHints({ dirty: false, pullRequest: { number: 12 } })).toEqual({
      commit: false,
      commitAndPush: false,
      viewPr: true,
    })
  })

  it('shows every chip when the tree is dirty and a pull request is open', () => {
    expect(visibleHints({ dirty: true, pullRequest: { number: 12 } })).toEqual({
      commit: true,
      commitAndPush: true,
      viewPr: true,
    })
  })
})

describe('suggestedCommitMessage', () => {
  it('names a single file', () => {
    expect(suggestedCommitMessage(['src/Hero.tsx'])).toBe('Update Hero.tsx')
  })

  it('counts several files', () => {
    expect(suggestedCommitMessage(['a.ts', 'b.ts', 'c.ts'])).toBe('Update 3 files')
  })
})

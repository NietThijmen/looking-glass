import { describe, expect, it } from 'vitest'
import { acceptBlock, changeBlocks, rejectBlock, segments } from './hunks'

const base = 'a\nb\nc\nd\ne\n'
const current = 'a\nB\nc\nd\ne\nf\n'

describe('hunks', () => {
  it('finds change blocks with line positions', () => {
    expect(changeBlocks(segments(base, current))).toEqual([
      { index: 0, oldLine: 2, oldCount: 1, newLine: 2, newCount: 1 },
      { index: 1, oldLine: 6, oldCount: 0, newLine: 6, newCount: 1 },
    ])
  })

  it('rejects one block and keeps the other', () => {
    expect(rejectBlock(base, current, 0)).toBe('a\nb\nc\nd\ne\nf\n')
    expect(rejectBlock(base, current, 1)).toBe('a\nB\nc\nd\ne\n')
  })

  it('accepts one block into the baseline', () => {
    expect(acceptBlock(base, current, 0)).toBe('a\nB\nc\nd\ne\n')
    expect(acceptBlock(base, current, 1)).toBe('a\nb\nc\nd\ne\nf\n')
  })

  it('handles new and deleted files', () => {
    expect(changeBlocks(segments('', 'x\ny\n'))).toEqual([
      { index: 0, oldLine: 1, oldCount: 0, newLine: 1, newCount: 2 },
    ])
    expect(rejectBlock('x\n', '', 0)).toBe('x\n')
  })

  it('accepting one block and rejecting the rest leaves no changes', () => {
    const b = acceptBlock(base, current, 0)
    expect(changeBlocks(segments(b, current))).toHaveLength(1)
    const c = rejectBlock(b, current, 0)
    expect(c).toBe(b)
    expect(c).toBe('a\nB\nc\nd\ne\n')
  })
})

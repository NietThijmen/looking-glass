import { describe, expect, it } from 'vitest'
import { sliceLines } from './AgentManager'

describe('sliceLines', () => {
  it('slices 1-based line windows', () => {
    expect(sliceLines('a\nb\nc', 2, 1)).toBe('b')
    expect(sliceLines('a\nb\nc', 2)).toBe('b\nc')
    expect(sliceLines('a\nb\nc', null, 2)).toBe('a\nb')
    expect(sliceLines('a\nb\nc')).toBe('a\nb\nc')
  })
})

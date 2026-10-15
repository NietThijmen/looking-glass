import { describe, expect, it } from 'vitest'
import { mergePaths } from './shellPath'

describe('mergePaths', () => {
  it('puts the login-shell PATH first and drops duplicates', () => {
    expect(mergePaths('/a:/b', '/b:/c')).toBe('/a:/b:/c')
  })

  it('keeps the current PATH when the shell PATH is unknown', () => {
    expect(mergePaths(null, '/c')).toBe('/c')
  })
})

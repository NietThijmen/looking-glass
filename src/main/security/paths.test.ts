import { describe, expect, it } from 'vitest'
import { hasOrigin } from './paths'

describe('hasOrigin', () => {
  it('matches exact origins only', () => {
    expect(hasOrigin('app://lookingglass/index.html', 'app://lookingglass')).toBe(true)
    expect(hasOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(hasOrigin('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(hasOrigin('https://evil.example/', 'app://lookingglass')).toBe(false)
  })

  it('handles missing and invalid URLs', () => {
    expect(hasOrigin(undefined, 'app://lookingglass')).toBe(false)
    expect(hasOrigin('not a url', 'app://lookingglass')).toBe(false)
  })
})

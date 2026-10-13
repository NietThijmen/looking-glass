import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasOrigin, resolveInside } from './paths'

const root = path.resolve('/srv/app')

describe('resolveInside', () => {
  it('resolves plain paths inside the root', () => {
    expect(resolveInside(root, 'index.html')).toBe(path.join(root, 'index.html'))
    expect(resolveInside(root, '/assets/app.js')).toBe(path.join(root, 'assets/app.js'))
    expect(resolveInside(root, 'a/../b.txt')).toBe(path.join(root, 'b.txt'))
  })

  it('returns the root itself for an empty path', () => {
    expect(resolveInside(root, '')).toBe(root)
  })

  it('rejects traversal out of the root', () => {
    expect(resolveInside(root, '../etc/passwd')).toBeNull()
    expect(resolveInside(root, 'a/../../etc/passwd')).toBeNull()
    expect(resolveInside(root, '%2e%2e/etc/passwd')).toBeNull()
    expect(resolveInside(root, '..%2fetc%2fpasswd')).toBeNull()
  })

  it('does not treat absolute request paths as absolute', () => {
    expect(resolveInside(root, '/etc/passwd')).toBe(path.join(root, 'etc/passwd'))
  })

  it('rejects sibling directories that share a prefix', () => {
    expect(resolveInside(root, '../app-secrets/key')).toBeNull()
  })

  it('rejects malformed encodings and NUL bytes', () => {
    expect(resolveInside(root, '%E0%A4%A')).toBeNull()
    expect(resolveInside(root, 'a%00.html')).toBeNull()
  })
})

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

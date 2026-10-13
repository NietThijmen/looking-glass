import { describe, expect, it } from 'vitest'
import type { SearchFileResult } from '../../shared/ipc'
import { buildRgArgs, collectRgLine } from './search'

function match(path: string, line: number, text: string, submatches: Array<[number, number]>): string {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: path },
      lines: { text },
      line_number: line,
      submatches: submatches.map(([start, end]) => ({ start, end })),
    },
  })
}

describe('buildRgArgs', () => {
  it('defaults to fixed-string smart-case search', () => {
    const args = buildRgArgs({ pattern: 'foo' })
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--smart-case')
    expect(args.slice(-4)).toEqual(['--regexp', 'foo', '--', '.'])
  })

  it('passes a leading-dash pattern safely via --regexp', () => {
    expect(buildRgArgs({ pattern: '--files' }).slice(-4)).toEqual(['--regexp', '--files', '--', '.'])
  })

  it('maps options and globs', () => {
    const args = buildRgArgs({
      pattern: 'a.b',
      regex: true,
      caseSensitive: true,
      wholeWord: true,
      include: 'src/**, *.ts',
      exclude: 'dist',
    })
    expect(args).not.toContain('--fixed-strings')
    expect(args).toContain('--case-sensitive')
    expect(args).toContain('--word-regexp')
    expect(args.join(' ')).toContain('--glob src/** --glob *.ts --glob !dist')
  })
})

describe('collectRgLine', () => {
  it('groups matches by file and strips ./', () => {
    const files = new Map<string, SearchFileResult>()
    expect(
      collectRgLine(
        match('./a.ts', 3, 'const foo = foo\n', [
          [6, 9],
          [12, 15],
        ]),
        files,
      ),
    ).toBe(2)
    collectRgLine(match('./a.ts', 7, 'foo()\n', [[0, 3]]), files)
    expect([...files.values()]).toEqual([
      {
        path: 'a.ts',
        matches: [
          {
            line: 3,
            text: 'const foo = foo',
            ranges: [
              [6, 9],
              [12, 15],
            ],
          },
          { line: 7, text: 'foo()', ranges: [[0, 3]] },
        ],
      },
    ])
  })

  it('converts UTF-8 byte offsets to string offsets', () => {
    const files = new Map<string, SearchFileResult>()
    // "é" is 2 bytes in UTF-8, "😀" is 4 bytes and 2 UTF-16 units.
    collectRgLine(match('b.ts', 1, 'é😀foo\n', [[6, 9]]), files)
    expect(files.get('b.ts')!.matches[0]!.ranges).toEqual([[3, 6]])
  })

  it('windows long lines around the first match', () => {
    const files = new Map<string, SearchFileResult>()
    const long = 'x'.repeat(1000) + 'needle' + 'y'.repeat(1000)
    collectRgLine(match('c.ts', 1, long, [[1000, 1006]]), files)
    const m = files.get('c.ts')!.matches[0]!
    expect(m.text.length).toBeLessThanOrEqual(301)
    const [s, e] = m.ranges[0]!
    expect(m.text.slice(s, e)).toBe('needle')
  })

  it('ignores non-match messages and garbage', () => {
    const files = new Map<string, SearchFileResult>()
    expect(collectRgLine('{"type":"begin","data":{}}', files)).toBe(0)
    expect(collectRgLine('not json', files)).toBe(0)
    expect(files.size).toBe(0)
  })
})

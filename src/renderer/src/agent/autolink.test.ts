import { describe, expect, it } from 'vitest'
import { autolink } from './autolink'

describe('autolink', () => {
  it('links bare urls and trims trailing punctuation', () => {
    expect(autolink([{ type: 'text', value: 'See https://example.com/a. Done' }])).toEqual([
      { type: 'text', value: 'See ' },
      {
        type: 'link',
        href: 'https://example.com/a',
        children: [{ type: 'text', value: 'https://example.com/a' }],
      },
      { type: 'text', value: '. Done' },
    ])
  })

  it('prefixes www links and keeps balanced parens', () => {
    expect(autolink([{ type: 'text', value: '(www.example.com/a_(b))' }])).toEqual([
      { type: 'text', value: '(' },
      {
        type: 'link',
        href: 'https://www.example.com/a_(b)',
        children: [{ type: 'text', value: 'www.example.com/a_(b)' }],
      },
      { type: 'text', value: ')' },
    ])
  })

  it('leaves existing links and code alone', () => {
    const nodes = [
      {
        type: 'link' as const,
        href: 'https://a.com',
        children: [{ type: 'text' as const, value: 'https://a.com' }],
      },
      { type: 'inlineCode' as const, value: 'https://b.com' },
    ]
    expect(autolink(nodes)).toEqual(nodes)
  })
})

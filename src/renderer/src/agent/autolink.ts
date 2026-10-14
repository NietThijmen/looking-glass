import type { InlineNode, MarkdownExtension } from '@tanstack/markdown'

// GitHub's extended autolinks: bare http(s):// and www. URLs become links.
const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<]+/gi
const trailingPunctuation = /[?!.,:;*_~'"]+$/

/** Drops trailing punctuation and unbalanced closing parens, as GitHub does. */
function trimUrl(url: string): string {
  let end = url.replace(trailingPunctuation, '')
  while (end.endsWith(')') && end.split('(').length < end.split(')').length) {
    end = end.slice(0, -1).replace(trailingPunctuation, '')
  }
  return end
}

function linkText(value: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let last = 0
  for (const match of value.matchAll(urlPattern)) {
    const url = trimUrl(match[0])
    if (!url.includes('.')) continue
    const start = match.index
    if (start > last) nodes.push({ type: 'text', value: value.slice(last, start) })
    const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url
    nodes.push({ type: 'link', href, children: [{ type: 'text', value: url }] })
    last = start + url.length
  }
  if (last === 0) return [{ type: 'text', value }]
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) })
  return nodes
}

export function autolink(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.type === 'text') return linkText(node.value)
    if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'strike') {
      return [{ ...node, children: autolink(node.children) }]
    }
    return [node]
  })
}

export function autolinkExtension(): MarkdownExtension {
  return { name: 'autolink', transformInline: (nodes) => autolink(nodes) }
}

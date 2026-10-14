/**
 * A function expression `(root) => markdown` for `browser_markdown`. It walks
 * the visible DOM under `root` and keeps what an agent needs from the page:
 * headings, lists, links with their targets, emphasis, code and simple tables.
 * Hidden elements, scripts and styles are left out.
 */
export const PAGE_TO_MARKDOWN = `(root) => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS'])
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'FORM', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DETAILS', 'SUMMARY', 'BLOCKQUOTE', 'FIELDSET'])
  const hidden = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true
    const style = getComputedStyle(el)
    return style.display === 'none' || style.visibility === 'hidden'
  }
  const squash = (s) => s.replace(/\\s+/g, ' ')
  const inline = (node) => {
    if (node.nodeType === 3) return squash(node.nodeValue || '')
    if (node.nodeType !== 1 || SKIP.has(node.tagName.toUpperCase()) || hidden(node)) return ''
    const tag = node.tagName
    const inner = () => Array.from(node.childNodes).map(inline).join('')
    if (tag === 'BR') return '\\n'
    if (tag === 'IMG') return node.alt ? '![' + node.alt + ']' : ''
    if (tag === 'A') {
      const text = inner().trim()
      const href = node.href
      return text && href && !href.startsWith('javascript:') ? '[' + text + '](' + href + ')' : text
    }
    if (tag === 'STRONG' || tag === 'B') return inner().trim() ? '**' + inner().trim() + '**' : ''
    if (tag === 'EM' || tag === 'I') return inner().trim() ? '_' + inner().trim() + '_' : ''
    if (tag === 'CODE') return '\`' + inner() + '\`'
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const label = node.getAttribute('aria-label') || node.placeholder || node.name || tag.toLowerCase()
      return '[' + label + (node.value ? ': ' + node.value : '') + ']'
    }
    if (tag === 'BUTTON') return inner().trim() ? '[' + inner().trim() + ']' : ''
    return inner()
  }
  const out = []
  const push = (s) => { if (s.trim()) out.push(s.trim()) }
  const block = (node, indent) => {
    if (node.nodeType === 3) return push(squash(node.nodeValue || ''))
    if (node.nodeType !== 1 || SKIP.has(node.tagName.toUpperCase()) || hidden(node)) return
    const tag = node.tagName
    const heading = /^H([1-6])$/.exec(tag)
    if (heading) return push('#'.repeat(Number(heading[1])) + ' ' + inline(node).trim())
    if (tag === 'PRE') return push('\`\`\`\\n' + node.textContent + '\\n\`\`\`')
    if (tag === 'HR') return push('---')
    if (tag === 'UL' || tag === 'OL') {
      let n = 0
      for (const li of node.children) {
        if (li.tagName !== 'LI' || hidden(li)) continue
        const own = Array.from(li.childNodes).filter((c) => !(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')))
        const text = own.map(inline).join('').trim()
        out.push(indent + (tag === 'OL' ? ++n + '. ' : '- ') + text)
        for (const nested of li.children) if (nested.tagName === 'UL' || nested.tagName === 'OL') block(nested, indent + '  ')
      }
      return
    }
    if (tag === 'TABLE') {
      const rows = Array.from(node.rows).map((r) => Array.from(r.cells).map((c) => inline(c).trim().replace(/\\|/g, '/')))
      rows.forEach((cells, i) => {
        out.push('| ' + cells.join(' | ') + ' |')
        if (i === 0) out.push('|' + cells.map(() => ' --- |').join(''))
      })
      return
    }
    const hasBlock = Array.from(node.children).some((c) => BLOCK.has(c.tagName) || /^(H[1-6]|UL|OL|PRE|TABLE|HR|P)$/.test(c.tagName))
    if (!hasBlock && (BLOCK.has(tag) || tag === 'LI')) return push(inline(node))
    if (!hasBlock && !BLOCK.has(tag)) return push(inline(node))
    let run = []
    const flush = () => { push(run.map(inline).join('')); run = [] }
    for (const child of node.childNodes) {
      const isBlock = child.nodeType === 1 && (BLOCK.has(child.tagName) || /^(H[1-6]|UL|OL|PRE|TABLE|HR|P|LI)$/.test(child.tagName))
      if (isBlock) { flush(); block(child, indent) } else run.push(child)
    }
    flush()
  }
  block(root, '')
  const tight = /^\\s*(- |\\d+\\. |\\|)/
  return out.reduce((acc, line, i) => acc + (i === 0 ? '' : tight.test(line) && tight.test(out[i - 1]) ? '\\n' : '\\n\\n') + line, '')
}`

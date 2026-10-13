import { File } from '@pierre/diffs/react'
import type { BlockNode, CodeBlockNode } from '@tanstack/markdown'
import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming'
import { parseMarkdown } from '@tanstack/markdown/parser'
import {
  renderBlockReact,
  type MarkdownComponents,
  type MarkdownReactOptions,
} from '@tanstack/markdown/react'
import { memo, useMemo } from 'react'
import { baseOptions } from '../editor/diffsConfig'

// Agent output is untrusted: keep TanStack Markdown's safe defaults (no raw HTML,
// executable URLs dropped). Links open in the system browser, never in the app.
const components = {
  a: ({ href, children, ...rest }) => (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void window.lookingglass.app.openExternal(href)
      }}
    >
      {children}
    </a>
  ),
} satisfies MarkdownComponents

const settled: MarkdownReactOptions = { components }
// The streaming profile tolerates unfinished syntax (open fences, half-written
// emphasis). Each update re-parses the accumulated text; no parser state is kept.
const streaming: MarkdownReactOptions = { components, extensions: [streamingMarkdownExtension()] }

const codeOptions = { ...baseOptions, overflow: 'wrap' } as const

/** Fenced code gets syntax highlighting from @pierre/diffs (Shiki), the same as the editor. */
const CodeBlock = memo(function CodeBlock({ node }: { node: CodeBlockNode }) {
  const file = useMemo(
    () => ({ name: node.file ?? `snippet.${node.lang ?? 'txt'}`, contents: node.value }),
    [node.file, node.lang, node.value],
  )
  return (
    <div className="my-2 overflow-hidden rounded border border-border text-[12px]">
      {node.title && (
        <div className="border-b border-border px-2 py-1 text-[11px] text-muted">{node.title}</div>
      )}
      <File file={file} options={codeOptions} disableWorkerPool />
    </div>
  )
})

function renderBlock(node: BlockNode, index: number, options: MarkdownReactOptions) {
  if (node.type === 'code') return <CodeBlock key={index} node={node} />
  return renderBlockReact(node, options, String(index))
}

export const Markdown = memo(function Markdown({ source, live = false }: { source: string; live?: boolean }) {
  const options = live ? streaming : settled
  const document = useMemo(() => parseMarkdown(source, options), [source, options])
  return <div className="markdown">{document.children.map((node, i) => renderBlock(node, i, options))}</div>
})

import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk'
import {
  describeRegion,
  elementSections,
  type ConsoleEntry,
  type Picked,
  type PickedElement,
} from '@lookingglass/shared/browser'
import type { Attachment, AttachmentPart } from '../store/agents'
import { useWorkspace } from '../store/workspace'

export function elementLabel(el: PickedElement): string {
  const suffix = el.id ? `#${el.id}` : el.classes[0] ? `.${el.classes[0]}` : ''
  return `<${el.tag}${suffix}>`
}

export function pickedLabel(item: Picked): string {
  return item.kind === 'region' ? `region ${item.rect.width}×${item.rect.height}` : elementLabel(item)
}

const text = (value: string): ContentBlock[] => [{ type: 'text', text: value }]

/**
 * A picked element or region as prompt content, split into parts the user can
 * untick in the chip preview: summary (always sent), markup, styles,
 * screenshot, source file link, and recent console errors (off by default).
 */
export function pickedAttachment(
  item: Picked,
  caps: PromptCapabilities,
  consoleErrors: ConsoleEntry[] = [],
): Attachment {
  const parts: AttachmentPart[] = []
  const noImages = caps.image ? '' : '\n(The screenshot is not included: this agent does not accept images.)'

  if (item.kind === 'region') {
    parts.push({ label: 'Summary', blocks: text(describeRegion(item) + noImages), on: true, locked: true })
  } else {
    const { summary, markup, styles } = elementSections(item)
    parts.push({ label: 'Summary', blocks: text(summary + noImages), on: true, locked: true })
    parts.push({ label: 'HTML', blocks: text(markup), on: true })
    if (styles) parts.push({ label: 'Styles', blocks: text(styles), on: true })
  }
  if (caps.image && item.screenshot)
    parts.push({
      label: 'Screenshot',
      blocks: [{ type: 'image', mimeType: 'image/png', data: item.screenshot }],
      on: true,
    })
  const root = useWorkspace.getState().info?.root
  const source = item.kind === 'element' ? item.sources.find((s) => s.via !== 'search') : undefined
  if (root && source)
    parts.push({
      label: `Source ${source.path}${source.line ? `:${source.line}` : ''}`,
      blocks: [{ type: 'resource_link', uri: encodeURI(`file://${root}/${source.path}`), name: source.path }],
      on: true,
    })
  if (consoleErrors.length)
    parts.push({
      label: `Console errors (${consoleErrors.length})`,
      blocks: consoleAttachment(consoleErrors).blocks,
      on: false,
    })

  return { label: pickedLabel(item), blocks: [], parts }
}

export function consoleAttachment(entries: ConsoleEntry[], label = 'browser console'): Attachment {
  const text = entries
    .map(
      (e) => `[${e.level}/${e.source}] ${e.text}${e.url ? ` (${e.url}${e.line ? `:${e.line}` : ''})` : ''}`,
    )
    .join('\n')
  return { label, blocks: [{ type: 'text', text: `Browser console:\n\`\`\`\n${text}\n\`\`\`` }] }
}

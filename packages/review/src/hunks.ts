import { diffLines } from 'diff'

/**
 * A file diff as alternating unchanged runs and change blocks. Each block can
 * independently take its old or new text, which is all per-hunk accept/reject
 * needs: rejecting a hunk rebuilds the current file with that block's old text;
 * accepting one rebuilds the baseline with its new text.
 */
export type Segment = { type: 'same'; text: string } | { type: 'change'; old: string; new: string }

export interface ChangeBlock {
  index: number
  /** 1-based first line in the old text (where the block sits, even if it removes nothing). */
  oldLine: number
  oldCount: number
  /** 1-based first line in the new text. */
  newLine: number
  newCount: number
}

export function segments(base: string, current: string): Segment[] {
  const result: Segment[] = []
  for (const part of diffLines(base, current)) {
    const last = result.at(-1)
    if (!part.added && !part.removed) {
      result.push({ type: 'same', text: part.value })
    } else if (last?.type === 'change') {
      if (part.added) last.new += part.value
      else last.old += part.value
    } else {
      result.push({ type: 'change', old: part.removed ? part.value : '', new: part.added ? part.value : '' })
    }
  }
  return result
}

const lineCount = (text: string): number =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

export function changeBlocks(parts: Segment[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = []
  let oldLine = 1
  let newLine = 1
  for (const part of parts) {
    if (part.type === 'same') {
      const n = lineCount(part.text)
      oldLine += n
      newLine += n
      continue
    }
    const oldCount = lineCount(part.old)
    const newCount = lineCount(part.new)
    blocks.push({ index: blocks.length, oldLine, oldCount, newLine, newCount })
    oldLine += oldCount
    newLine += newCount
  }
  return blocks
}

/** Rebuild text choosing, for each change block, its old or new side. */
export function compose(parts: Segment[], pick: (blockIndex: number) => 'old' | 'new'): string {
  let block = 0
  return parts.map((p) => (p.type === 'same' ? p.text : p[pick(block++)])).join('')
}

/** Current text with block `index` reverted to the baseline. */
export function rejectBlock(base: string, current: string, index: number): string {
  return compose(segments(base, current), (i) => (i === index ? 'old' : 'new'))
}

/** Baseline text with block `index` taken from the current text. */
export function acceptBlock(base: string, current: string, index: number): string {
  return compose(segments(base, current), (i) => (i === index ? 'new' : 'old'))
}

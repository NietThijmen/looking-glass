import { useRef } from 'react'

type Axis = 'horizontal' | 'vertical'

export function ResizeHandle({
  axis,
  onDelta,
  'data-testid': testId,
}: {
  axis: Axis
  onDelta(delta: number): void
  'data-testid'?: string
}) {
  const dragging = useRef(false)

  return (
    <div
      role="separator"
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      data-testid={testId}
      className={`no-drag shrink-0 touch-none ${
        axis === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60'
          : 'h-1 cursor-row-resize hover:bg-accent/40 active:bg-accent/60'
      }`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const delta = axis === 'horizontal' ? e.movementX : e.movementY
        if (delta !== 0) onDelta(delta)
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
    />
  )
}

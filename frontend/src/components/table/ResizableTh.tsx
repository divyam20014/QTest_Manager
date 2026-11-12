import { type ReactNode, useRef } from 'react'

import { cn } from '@/lib/utils'

// Requires the parent <table> to use `table-layout: fixed` with a
// <colgroup> driven by the same widths -- otherwise a <th> width is only
// a hint and real column width is governed by cell content.
export function ResizableTh({
  width,
  onResize,
  minWidth = 72,
  className,
  children,
}: {
  width?: number
  onResize: (width: number) => void
  minWidth?: number
  className?: string
  children: ReactNode
}) {
  const thRef = useRef<HTMLTableCellElement>(null)

  function handlePointerDown(event: React.PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = thRef.current?.offsetWidth ?? width ?? 150

    function handleMove(moveEvent: PointerEvent) {
      onResize(Math.max(minWidth, startWidth + (moveEvent.clientX - startX)))
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <th
      ref={thRef}
      style={width ? { width, minWidth: Math.min(width, minWidth) } : undefined}
      className={cn('relative select-none px-4 py-2 font-medium', className)}
    >
      <div className="truncate pr-2">{children}</div>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        onPointerDown={handlePointerDown}
        className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none hover:bg-[var(--ring)]"
      />
    </th>
  )
}

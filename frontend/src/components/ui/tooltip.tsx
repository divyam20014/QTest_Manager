import { type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * Dependency-free tooltip that works for keyboard and screen-reader users,
 * unlike the native `title` attribute (hover-only, invisible on touch, not
 * reliably announced). Shows on hover and on keyboard focus-within, and wires
 * aria-describedby to the trigger wrapper.
 *
 * The bubble is `display: none` until hover or focus (not just invisible), so a trigger near the
 * right edge of a phone cannot widen the page with a bubble nobody can see.
 *
 * Put it around a single focusable element (button/link). Tooltips supplement
 * a visible text or aria-label name; they never replace one.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
  /** `end` right-aligns the bubble to its trigger, for triggers at the right edge of a scrolling table. */
  align?: 'center' | 'end'
  className?: string
}) {
  const id = useId()
  // No text to show (e.g. a conditional hint): render the trigger untouched.
  if (content === null || content === undefined || content === false || content === '') return <>{children}</>
  return (
    <span className={cn('group/tooltip relative inline-flex', className)} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-[var(--z-dropdown)] whitespace-nowrap rounded-[var(--radius-control)] bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] hidden shadow-md group-hover/tooltip:block group-focus-within/tooltip:block',
          align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  )
}

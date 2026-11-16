import { type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * Dependency-free tooltip that works for keyboard and screen-reader users,
 * unlike the native `title` attribute (hover-only, invisible on touch, not
 * reliably announced). Shows on hover and on keyboard focus-within, and wires
 * aria-describedby to the trigger wrapper.
 *
 * Put it around a single focusable element (button/link). Tooltips supplement
 * a visible text or aria-label name; they never replace one.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
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
          'pointer-events-none absolute left-1/2 z-[var(--z-dropdown)] -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-control)] bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] invisible opacity-0 shadow-md transition-[opacity,visibility] duration-[var(--motion-base)] group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-focus-within/tooltip:visible group-focus-within/tooltip:opacity-100 motion-reduce:transition-none',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  )
}

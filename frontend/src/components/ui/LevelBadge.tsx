import type { HTMLAttributes } from 'react'

import type { BadgeTone } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--status-neutral)]',
  positive: 'bg-[var(--status-good)]',
  warning: 'bg-[var(--status-warning)]',
  critical: 'bg-[var(--status-serious)]',
  info: 'bg-[var(--status-info)]',
}

/**
 * Priority / severity indicator used by every list: a coloured dot plus the
 * label. The label is always rendered, so colour is never the only signal
 * (status uses the soft `StatusBadge` pill instead). Take the tone from the
 * shared `levelTone()` mapping (lib/statusTones.ts).
 */
export function LevelBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)} {...props}>
      <span aria-hidden="true" data-level-dot className={cn('size-2 shrink-0 rounded-full', DOT_CLASSES[tone])} />
      {children}
    </span>
  )
}

export const PriorityBadge = LevelBadge
export const SeverityBadge = LevelBadge

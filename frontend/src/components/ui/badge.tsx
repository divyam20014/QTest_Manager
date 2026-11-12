import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

// Derived from the shared --status-* tokens (index.css) so every status
// indicator in the app -- badges, toasts, empty states -- draws from one
// palette instead of badges hardcoding their own emerald/amber/red shades
// that drift from the rest of the app's dark-mode-aware status colors.
const TONE_CLASSES = {
  neutral: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]',
  positive: 'bg-[var(--status-good-bg)] text-[var(--status-good)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]',
  critical: 'bg-[var(--status-serious-bg)] text-[var(--status-serious)]',
} as const

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONE_CLASSES }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  )
}

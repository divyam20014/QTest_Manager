import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const TONE_CLASSES = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
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

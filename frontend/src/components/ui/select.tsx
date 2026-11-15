import { type SelectHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        // Dashboard redesign Phase 3: same inset-well + outline-focus
        // treatment as Input/Textarea. Keeps bg-[var(--background)]
        // (not transparent, unlike Input) so the inset shadow still
        // reads as a shallow well rather than a double-border artifact.
        'qth-pressed-sm flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

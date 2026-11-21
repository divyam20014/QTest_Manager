import { type TextareaHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        // Dashboard redesign Phase 3: same inset-well + outline-focus
        // treatment as Input, for visual consistency between the two.
        'qth-pressed-sm flex min-h-16 w-full rounded-md border border-[var(--control-border,var(--border))] bg-transparent px-3 py-2 text-sm',
        'placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1',
        'focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        // Mobile redesign Phase 2: 16px text (no iOS focus zoom), taller start.
        'max-md:min-h-24 max-md:text-base',
        'aria-[invalid=true]:border-[var(--destructive)]',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

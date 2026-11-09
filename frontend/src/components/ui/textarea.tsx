import { type TextareaHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-16 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm',
        'placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-1',
        'focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

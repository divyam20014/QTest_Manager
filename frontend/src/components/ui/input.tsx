import { type InputHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // Dashboard redesign Phase 3: a light inset "well" (smallest
        // pressed token -- dense forms stay calm, this isn't the dramatic
        // Dashboard treatment) plus an outline-based focus state instead
        // of the old ring, since a box-shadow ring would visually fight
        // the new inset shadow (both animate the same CSS property).
        'qth-pressed-sm flex h-9 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm',
        'placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1',
        'focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

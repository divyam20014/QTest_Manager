import { type InputHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm',
        'placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-1',
        'focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

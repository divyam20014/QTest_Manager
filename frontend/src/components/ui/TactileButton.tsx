import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Button variant with a visible press-depth effect: raised at rest,
 * flips to an inset "pressed" shadow + slight scale-down on :active.
 * Separate component from Button (not a new variant on it) because the
 * shadow-flip + transform interaction is a different enough mechanism
 * that folding it into buttonVariants would make that file's variants
 * inconsistent (flat vs. tactile don't share a transition model).
 */
export const tactileButtonVariants = cva(
  [
    'qth-raised-sm qth-tactile-btn inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--tactile-surface-raised)] text-sm font-medium text-[var(--foreground)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
  ].join(' '),
  {
    variants: {
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

export interface TactileButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof tactileButtonVariants> {}

export const TactileButton = forwardRef<HTMLButtonElement, TactileButtonProps>(
  ({ className, size, ...props }, ref) => (
    <button ref={ref} className={cn(tactileButtonVariants({ size }), className)} {...props} />
  ),
)
TactileButton.displayName = 'TactileButton'

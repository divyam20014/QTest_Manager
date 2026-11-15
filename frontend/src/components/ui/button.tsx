import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    // Dashboard redesign Phase 3: every button gets a visible focus-visible
    // outline (there was none before -- relied on the browser default).
    // Outline is a separate CSS property from box-shadow, so it never gets
    // swallowed by the tactile default variant's own box-shadow below.
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
    // Mobile redesign Phase 2: 44px minimum touch target on phones, whatever
    // the size variant (desktop sizes are untouched).
    'max-md:min-h-11',
  ].join(' '),
  {
    variants: {
      variant: {
        // Subtle lift + press-depth on the primary action only (reuses
        // the Phase 1 tokens -- qth-raised-sm is the smallest elevation
        // step, deliberately not the dramatic EmbossedCard/TactileButton
        // treatment, so it reads as "this is the one real button" without
        // adding noise to toolbars full of outline/ghost buttons).
        default: 'qth-raised-sm qth-tactile-btn bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90',
        outline: 'border border-[var(--border)] bg-transparent hover:bg-[var(--muted)]',
        destructive: 'bg-[var(--destructive)] text-white hover:opacity-90',
        ghost: 'hover:bg-[var(--muted)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'

import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
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
        // Phone primary: 48px (min-h-12) -- the one primary action per screen is the
        // biggest target; every other variant stays at the shared 44px floor.
        default:
          'qth-raised-sm qth-tactile-btn bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 max-md:min-h-12',
        outline:
          'border border-[var(--border)] bg-transparent hover:bg-[var(--muted)] active:bg-[var(--muted)] active:shadow-[var(--elevation-pressed-sm)]',
        destructive: 'bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90 active:opacity-75',
        // Solid positive action (Execution Console "Pass"). Same tactile lift as
        // default, with AA-contrast text on the green in both themes.
        success:
          'qth-raised-sm qth-tactile-btn bg-[var(--success-solid)] text-[var(--success-solid-foreground)] hover:opacity-90',
        ghost: 'hover:bg-[var(--muted)] active:bg-[var(--muted)] active:shadow-[var(--elevation-pressed-sm)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-6',
        // Design system Phase B: square icon-only button. ALWAYS pass an
        // aria-label. 44px on phones via the shared max-md:min-h-11 plus width.
        icon: 'size-9 p-0 max-md:min-w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * Pending state: shows a spinner, sets aria-busy, disables the button and keeps the
   * label (and so the width) unchanged. Use for mutation submit buttons.
   */
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

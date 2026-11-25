import { type ButtonHTMLAttributes, forwardRef } from 'react'

import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: names the button for screen readers and is shown as its tooltip. */
  'aria-label': string
  /** The tooltip text when it should be shorter than the accessible name (which may say what it acts on). */
  tooltip?: string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  /** Where the tooltip bubble sits; `end` for buttons at the right edge of a table row. */
  tooltipAlign?: 'center' | 'end'
  /** Where the tooltip opens; `bottom` for controls in the top bar (above them is off-screen). */
  tooltipSide?: 'top' | 'bottom'
}

/** Icon-only button: 32px minimum hit area (44px on phones), built-in tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ 'aria-label': label, tooltip, size = 'md', variant = 'ghost', tooltipAlign, tooltipSide, className, type = 'button', children, ...props }, ref) => (
    <Tooltip content={tooltip ?? label} align={tooltipAlign} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors duration-[var(--motion-base)] motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          'disabled:pointer-events-none disabled:opacity-50 max-md:size-11 [&_svg]:size-4 [&_svg]:shrink-0',
          size === 'sm' ? 'size-8' : 'size-9',
          variant === 'ghost'
            ? 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
            : 'border border-[var(--border)] bg-[var(--tactile-surface-raised)] text-[var(--foreground)] hover:bg-[var(--muted)]',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  ),
)
IconButton.displayName = 'IconButton'

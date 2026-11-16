import { type LabelHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form label. `required` appends the one standard required marker (a red
 * asterisk for sighted users, "(required)" for screen readers) so forms never
 * hand-roll their own. Optional fields say "(optional)" in their text instead.
 */
export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none text-[var(--foreground)]', className)}
      {...props}
    >
      {children}
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-[var(--destructive)]">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  ),
)
Label.displayName = 'Label'

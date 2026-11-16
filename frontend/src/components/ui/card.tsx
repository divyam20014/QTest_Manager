import { type HTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-sm', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-4', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

// UX-023: the heading level is configurable (default h2, since every page has
// one h1 and card titles are its direct sections). Use `as="h3"` for a card
// nested under another section heading so levels never skip.
export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }
>(({ className, as: Tag = 'h2', ...props }, ref) => (
  <Tag ref={ref} className={cn('text-sm font-medium text-[var(--muted-foreground)]', className)} {...props} />
))
CardTitle.displayName = 'CardTitle'

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />,
)
CardContent.displayName = 'CardContent'

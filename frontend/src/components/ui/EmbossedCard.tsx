import { type HTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

/**
 * Raised, tactile counterpart to Card -- same content slots (use the
 * existing CardHeader/CardTitle/CardContent), but rendered on the
 * --tactile-surface material with a dual-direction emboss shadow
 * instead of the flat shadow-sm border card. Reserved for dashboard
 * hero widgets, not dense list/table screens (texture + soft shadow at
 * that density reads as noise, not polish).
 */
export const EmbossedCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'qth-texture qth-raised-md rounded-xl bg-[var(--tactile-surface)]',
        className,
      )}
      {...props}
    />
  ),
)
EmbossedCard.displayName = 'EmbossedCard'

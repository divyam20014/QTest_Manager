import { AlertTriangle, CheckCircle2, CircleDot, Info, XCircle } from 'lucide-react'
import type { HTMLAttributes } from 'react'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONE_ICON = {
  neutral: CircleDot,
  positive: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
  info: Info,
} as const

/**
 * A Badge that also carries a small icon, so a status is never conveyed by
 * colour alone (the design system's rule for the reserved --status-* colours).
 *
 * Use `Badge` for plain labels/counts (e.g. a role name, "3 selected"); use
 * `StatusBadge` for anything that is a *state* -- run/defect/project status,
 * severity, verdicts. The tone for a given status value should come from one
 * mapping per domain (see statusDisplay.ts beside each module), never be
 * chosen ad hoc at the call site.
 */
export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const Icon = TONE_ICON[tone]
  return (
    <Badge tone={tone} className={cn('gap-1', className)} {...props}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {children}
    </Badge>
  )
}

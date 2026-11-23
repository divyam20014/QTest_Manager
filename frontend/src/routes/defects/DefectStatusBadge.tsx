import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { statusDisplay } from './statusDisplay'

/**
 * A defect status as a pill with an icon AND the label, so it never relies on colour alone.
 * `label` is the tenant's display name for the status (the API's `status_label`); the code decides
 * the tone and icon.
 */
export function DefectStatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const { tone, Icon } = statusDisplay(status)
  return (
    <Badge tone={tone} className={cn('gap-1 whitespace-nowrap', className)}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label ?? status}
    </Badge>
  )
}

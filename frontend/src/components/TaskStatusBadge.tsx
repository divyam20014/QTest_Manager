import type { TaskStatusRef } from '@/api/tasks'
import { Badge } from '@/components/ui/badge'
import { categoryTone } from '@/lib/taskTree'

/**
 * A task's status. The badge tone follows the status's fixed category (so contrast always holds in
 * every theme); the tenant's own colour for the status shows as the dot beside the label.
 */
export function TaskStatusBadge({ status }: { status: Pick<TaskStatusRef, 'label' | 'category' | 'color'> }) {
  return (
    <Badge tone={categoryTone(status.category)} className="gap-1.5">
      {status.color && (
        <span
          aria-hidden="true"
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: status.color }}
        />
      )}
      {status.label}
    </Badge>
  )
}

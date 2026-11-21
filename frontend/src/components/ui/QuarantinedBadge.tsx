import { ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/** ADR-097: text + icon, never colour alone. */
export function QuarantinedBadge({ title }: { title?: string | null }) {
  return (
    <Badge tone="warning" className="gap-1" title={title ? `Quarantined: ${title}` : 'Quarantined'}>
      <ShieldAlert aria-hidden="true" className="h-3 w-3" />
      Quarantined
    </Badge>
  )
}

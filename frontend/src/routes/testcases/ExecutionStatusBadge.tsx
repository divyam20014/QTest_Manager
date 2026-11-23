import { Ban, CheckCircle2, CircleDashed, SkipForward, XCircle, type LucideIcon } from 'lucide-react'

import type { ExecutionStatus } from '@/api/testCases'
import { Badge, type BadgeTone } from '@/components/ui/badge'

// ADR-116: the execution status of a test case is derived from its latest executed
// run case. Shown as a pill with an icon AND a label, so it never relies on colour alone.
const DISPLAY: Record<ExecutionStatus, { tone: BadgeTone; Icon: LucideIcon }> = {
  Pass: { tone: 'positive', Icon: CheckCircle2 },
  Fail: { tone: 'critical', Icon: XCircle },
  Blocked: { tone: 'warning', Icon: Ban },
  Skipped: { tone: 'neutral', Icon: SkipForward },
  'Not Run': { tone: 'neutral', Icon: CircleDashed },
}

export function ExecutionStatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status && status in DISPLAY ? status : 'Not Run') as ExecutionStatus
  const { tone, Icon } = DISPLAY[key]
  return (
    <Badge tone={tone} className="gap-1 whitespace-nowrap">
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {key}
    </Badge>
  )
}

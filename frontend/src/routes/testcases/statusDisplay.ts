import type { Priority, TestCaseStatus } from '@/api/testCases'
import type { BadgeTone } from '@/components/ui/badge'
import { levelTone } from '@/lib/statusTones'

export const STATUS_DISPLAY: Record<
  TestCaseStatus,
  { label: string; tone: 'neutral' | 'warning' | 'positive' | 'critical' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  ready_for_review: { label: 'Ready for Review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'positive' },
  deprecated: { label: 'Deprecated', tone: 'critical' },
}

// Priority shares the app-wide level scale (src/lib/statusTones.ts).
export function priorityTone(priority: Priority): BadgeTone {
  return levelTone(priority)
}

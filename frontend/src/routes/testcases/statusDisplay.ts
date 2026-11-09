import type { Priority, TestCaseStatus } from '@/api/testCases'

export const STATUS_DISPLAY: Record<
  TestCaseStatus,
  { label: string; tone: 'neutral' | 'warning' | 'positive' | 'critical' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  ready_for_review: { label: 'Ready for Review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'positive' },
  deprecated: { label: 'Deprecated', tone: 'critical' },
}

export const PRIORITY_TONE: Record<Priority, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}

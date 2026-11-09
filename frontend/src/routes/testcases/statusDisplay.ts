import type { TestCaseStatus } from '@/api/testCases'

export const STATUS_DISPLAY: Record<TestCaseStatus, { label: string; tone: 'neutral' | 'warning' | 'positive' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  ready_for_review: { label: 'Ready for Review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'positive' },
  deprecated: { label: 'Deprecated', tone: 'neutral' },
}

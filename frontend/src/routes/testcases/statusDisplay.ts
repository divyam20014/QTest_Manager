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

// Tier 5 / ADR-055: priority is tenant-configurable now, so this map only
// covers the four seeded defaults -- `priorityTone` below falls back to
// 'neutral' for any tenant-added custom priority it doesn't recognize.
const PRIORITY_TONE: Partial<Record<Priority, 'neutral' | 'warning' | 'positive' | 'critical'>> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}

export function priorityTone(priority: Priority): 'neutral' | 'warning' | 'positive' | 'critical' {
  return PRIORITY_TONE[priority] ?? 'neutral'
}

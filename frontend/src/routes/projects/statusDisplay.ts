import type { Priority, ProjectStatus } from '@/api/projects'

export const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  'On Track': 'positive',
  'At Risk': 'warning',
  Delayed: 'critical',
  Completed: 'neutral',
}

export const PRIORITY_TONE: Record<Priority, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}

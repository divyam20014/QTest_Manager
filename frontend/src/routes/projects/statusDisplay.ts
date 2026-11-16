import type { Priority, ProjectStatus } from '@/api/projects'
import type { BadgeTone } from '@/components/ui/badge'
import { levelTone } from '@/lib/statusTones'

export const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  'On Track': 'positive',
  'At Risk': 'warning',
  Delayed: 'critical',
  Completed: 'neutral',
}

export const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  Low: levelTone('Low'),
  Medium: levelTone('Medium'),
  High: levelTone('High'),
  Critical: levelTone('Critical'),
}

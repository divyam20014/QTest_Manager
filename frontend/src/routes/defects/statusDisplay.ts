import type { DefectStatus, Severity } from '@/api/defects'

export const STATUS_ORDER: DefectStatus[] = ['New', 'Open', 'Fixed', 'Verified', 'Closed']

export const STATUS_TONE: Record<DefectStatus, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  New: 'critical',
  Open: 'warning',
  Fixed: 'warning',
  Verified: 'positive',
  Closed: 'neutral',
}

export const SEVERITY_TONE: Record<Severity, 'neutral' | 'warning' | 'positive' | 'critical'> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}

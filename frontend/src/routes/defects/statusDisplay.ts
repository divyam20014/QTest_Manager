import type { DefectStatus, RootCause, Severity } from '@/api/defects'

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

export const ROOT_CAUSES: RootCause[] = [
  'requirements_gap',
  'code_defect',
  'design_flaw',
  'test_data_issue',
  'environment_issue',
  'third_party_integration',
  'other',
]

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  requirements_gap: 'Requirements Gap',
  code_defect: 'Code Defect',
  design_flaw: 'Design Flaw',
  test_data_issue: 'Test Data Issue',
  environment_issue: 'Environment Issue',
  third_party_integration: 'Third-Party Integration',
  other: 'Other',
}

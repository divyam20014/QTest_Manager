import { API_BASE_URL, apiFetch } from '@/api/client'

export type Metric = 'run_status' | 'priority' | 'defect_severity' | 'defect_status'
export type GroupBy = 'project' | 'domain' | 'assignee'

export interface AggregateRow {
  group_key: string | null
  group_label: string
  value: string
  count: number
}

export interface AggregateReport {
  metric: Metric
  group_by: GroupBy
  rows: AggregateRow[]
}

export interface DashboardSummary {
  projects: { total: number; by_status: Record<string, number> }
  test_cases: { total: number; approved_ratio: number }
  test_runs: { active: number; step_pass_percentage: number }
  defects: { open_by_severity: Record<string, number> }
}

export interface DomainDistributionEntry {
  domain: string
  project_count: number
  test_case_count: number
  approved_percentage: number
  open_defect_count: number
}

export interface ActivityEntry {
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string
  created_at: string
}

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/dashboard/summary')
}

export function fetchDomainDistribution(): Promise<DomainDistributionEntry[]> {
  return apiFetch<DomainDistributionEntry[]>('/dashboard/domain-distribution')
}

export function fetchActivityStream(): Promise<ActivityEntry[]> {
  return apiFetch<ActivityEntry[]>('/dashboard/activity-stream')
}

export function fetchAggregateReport(metric: Metric, groupBy: GroupBy): Promise<AggregateReport> {
  return apiFetch<AggregateReport>(`/reports/aggregate?metric=${metric}&group_by=${groupBy}`)
}

export const complianceExportUrl = `${API_BASE_URL}/reports/compliance-export`

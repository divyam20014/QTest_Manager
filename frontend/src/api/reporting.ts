import { API_BASE_URL, apiFetch } from '@/api/client'

export type Metric =
  | 'run_status'
  | 'priority'
  | 'test_case_status'
  | 'defect_severity'
  | 'defect_status'
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

export interface AggregateReportFilters {
  projectId?: string
  domain?: string
  assigneeId?: string
  dateFrom?: string
  dateTo?: string
  priority?: string
  status?: string
}

export interface DashboardSummary {
  projects: { total: number; active: number; by_status: Record<string, number> }
  test_cases: { total: number; approved_count: number; approved_ratio: number }
  test_runs: { active: number; step_pass_percentage: number }
  defects: { open_by_severity: Record<string, number>; critical_count: number }
}

export interface DomainDistributionEntry {
  domain: string
  project_count: number
  test_case_count: number
  approved_percentage: number
  open_defect_count: number
  pass_percentage: number
}

export interface ActivityEntry {
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string
  created_at: string
}

export interface ExecutionTrendPoint {
  date: string
  pass_count: number
  fail_count: number
  ignore_count: number
}

export interface ExecutionTrendReport {
  points: ExecutionTrendPoint[]
}

export interface ComplianceTestCaseRow {
  id: string
  title: string
  status: string
  priority: string
}

export interface ComplianceDefectRow {
  id: string
  title: string
  severity: string
  status: string
}

export interface ComplianceProjectSection {
  project_id: string
  name: string
  domain: string
  total_test_cases: number
  approved_test_cases: number
  draft_test_cases: number
  ready_for_review_test_cases: number
  open_defects: number
  critical_defects: number
  test_cases: ComplianceTestCaseRow[]
  defects: ComplianceDefectRow[]
}

export interface ComplianceReport {
  tenant_name: string
  generated_at: string
  reporting_officer_name: string
  reporting_officer_email: string
  period_from: string | null
  period_to: string | null
  projects: ComplianceProjectSection[]
}

export interface CompliancePeriod {
  periodFrom?: string
  periodTo?: string
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

function buildAggregateParams(
  metric: Metric,
  groupBy: GroupBy,
  filters: AggregateReportFilters = {}
): URLSearchParams {
  const params = new URLSearchParams({ metric, group_by: groupBy })
  if (filters.projectId) params.set('project_id', filters.projectId)
  if (filters.domain) params.set('domain', filters.domain)
  if (filters.assigneeId) params.set('assignee_id', filters.assigneeId)
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.status) params.set('status', filters.status)
  return params
}

export function fetchAggregateReport(
  metric: Metric,
  groupBy: GroupBy,
  filters: AggregateReportFilters = {}
): Promise<AggregateReport> {
  const params = buildAggregateParams(metric, groupBy, filters)
  return apiFetch<AggregateReport>(`/reports/aggregate?${params.toString()}`)
}

export function fetchExecutionTrend(
  days = 30,
  projectId?: string
): Promise<ExecutionTrendReport> {
  const params = new URLSearchParams({ days: String(days) })
  if (projectId) params.set('project_id', projectId)
  return apiFetch<ExecutionTrendReport>(`/reports/execution-trend?${params.toString()}`)
}

export function fetchComplianceDetail(period: CompliancePeriod = {}): Promise<ComplianceReport> {
  const params = new URLSearchParams()
  if (period.periodFrom) params.set('period_from', period.periodFrom)
  if (period.periodTo) params.set('period_to', period.periodTo)
  const query = params.toString()
  return apiFetch<ComplianceReport>(`/reports/compliance-detail${query ? `?${query}` : ''}`)
}

export function complianceExportUrl(period: CompliancePeriod = {}): string {
  const params = new URLSearchParams()
  if (period.periodFrom) params.set('period_from', period.periodFrom)
  if (period.periodTo) params.set('period_to', period.periodTo)
  const query = params.toString()
  return `${API_BASE_URL}/reports/compliance-export${query ? `?${query}` : ''}`
}

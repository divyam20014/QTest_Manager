import { API_BASE_URL, apiFetch } from '@/api/client'

export type Metric =
  | 'run_status'
  | 'priority'
  | 'test_case_status'
  | 'defect_severity'
  | 'defect_status'
  | 'defect_root_cause'
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
  test_runs: { active: number; step_pass_percentage: number; step_sample_size: number }
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

export interface DefectTrendPoint {
  date: string
  opened_count: number
  closed_count: number
}

export interface DefectTrendReport {
  points: DefectTrendPoint[]
}

export interface DefectAgingSeverityBucket {
  severity: string
  open_count: number
  breached_count: number
}

export interface DefectAgingSummary {
  buckets: DefectAgingSeverityBucket[]
  total_open: number
  total_breached: number
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

export interface DefectAgingSeverityBucket {
  severity: string
  open_count: number
  breached_count: number
}

export interface DefectAgingSummary {
  buckets: DefectAgingSeverityBucket[]
  total_open: number
  total_breached: number
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
  requirement_total: number
  requirement_covered: number
  requirement_coverage_percentage: number
  defect_aging: DefectAgingSummary
}

export interface CompliancePeriodComparison {
  test_cases_created_current: number
  test_cases_created_prior: number
  defects_opened_current: number
  defects_opened_prior: number
  defects_closed_current: number
  defects_closed_prior: number
}

export interface ComplianceReport {
  tenant_name: string
  generated_at: string
  reporting_officer_name: string
  reporting_officer_email: string
  period_from: string | null
  period_to: string | null
  projects: ComplianceProjectSection[]
  trend: CompliancePeriodComparison | null
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

export function fetchDefectTrend(
  days = 30,
  projectId?: string
): Promise<DefectTrendReport> {
  const params = new URLSearchParams({ days: String(days) })
  if (projectId) params.set('project_id', projectId)
  return apiFetch<DefectTrendReport>(`/reports/defect-trend?${params.toString()}`)
}

export function fetchDefectAgingSummary(projectId?: string): Promise<DefectAgingSummary> {
  const params = new URLSearchParams()
  if (projectId) params.set('project_id', projectId)
  const query = params.toString()
  return apiFetch<DefectAgingSummary>(`/reports/defect-aging${query ? `?${query}` : ''}`)
}

export interface ReleaseReadinessReport {
  project_id: string
  release_id: string | null
  release_name: string | null
  total_test_cases: number
  execution_completion_percentage: number
  pass_percentage: number
  open_defects_by_severity: Record<string, number>
  requirement_coverage_percentage: number
}

export function fetchReleaseReadiness(
  projectId: string,
  releaseId?: string,
): Promise<ReleaseReadinessReport> {
  const params = new URLSearchParams({ project_id: projectId })
  if (releaseId) params.set('release_id', releaseId)
  return apiFetch<ReleaseReadinessReport>(`/reports/release-readiness?${params.toString()}`)
}

export interface WorkloadEntry {
  user_id: string
  user_name: string | null
  assigned_test_cases: number
  assigned_test_run_cases_pending: number
  assigned_test_run_cases_in_progress: number
  defects_reported_open: number
}

export interface WorkloadSummary {
  project_id: string
  entries: WorkloadEntry[]
}

export function fetchWorkloadSummary(projectId: string): Promise<WorkloadSummary> {
  return apiFetch<WorkloadSummary>(`/reports/workload?project_id=${projectId}`)
}

export interface FlakyTestEntry {
  test_case_id: string
  test_case_title: string
  run_count: number
  flip_count: number
  flip_rate: number
}

export interface FlakyTestReport {
  project_id: string
  tests: FlakyTestEntry[]
}

export function fetchFlakyTests(projectId: string): Promise<FlakyTestReport> {
  return apiFetch<FlakyTestReport>(`/reports/flaky-tests?project_id=${projectId}`)
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

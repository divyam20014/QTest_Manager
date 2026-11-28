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
  /** Baseline `days` ago (ADR-110); absent from older servers, then no trend is shown. */
  previous?: {
    days: number
    test_cases_total: number
    active_runs: number
    open_defects: number
    step_pass_percentage: number
    step_sample_size: number
  } | null
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

// ADR-079: both take an optional project to narrow every figure / event to it.
export function fetchDashboardSummary(projectId?: string): Promise<DashboardSummary> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return apiFetch<DashboardSummary>(`/dashboard/summary${qs}`)
}

export function fetchDomainDistribution(): Promise<DomainDistributionEntry[]> {
  return apiFetch<DomainDistributionEntry[]>('/dashboard/domain-distribution')
}

export function fetchActivityStream(projectId?: string): Promise<ActivityEntry[]> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return apiFetch<ActivityEntry[]>(`/dashboard/activity-stream${qs}`)
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
  /** ADR-137: the figures always cover the whole project. */
  scope?: 'project'
  release_id: string | null
  release_name: string | null
  total_test_cases: number
  execution_completion_percentage: number
  pass_percentage: number
  open_defects_by_severity: Record<string, number>
  requirement_coverage_percentage: number
  /** ADR-097: cases flagged quarantined; reported separately, never silently counted as passing. */
  quarantined_count?: number
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
  quarantined?: boolean
}

export interface FlakyTestReport {
  project_id: string
  tests: FlakyTestEntry[]
}

export function fetchFlakyTests(projectId: string, limit?: number): Promise<FlakyTestReport> {
  const extra = limit ? `&limit=${limit}` : ''
  return apiFetch<FlakyTestReport>(`/reports/flaky-tests?project_id=${projectId}${extra}`)
}

export interface TraceabilityMatrixEntry {
  requirement_id: string
  display_id: string | null
  requirement_title: string
  status: 'draft' | 'approved' | 'retired'
  review_count: number
  /** ADR-127: the task the requirement belongs to, if any. */
  task_id: string | null
  task_display_id: string | null
  linked_test_case_count: number
  passed_count: number
  failed_count: number
  blocked_count: number
  not_executed_count: number
  coverage_percentage: number
}

export interface TraceabilityMatrixReport {
  project_id: string
  total_requirements: number
  /** Listed, but not counted in the coverage percentage. */
  retired_requirements: number
  overall_requirement_coverage_percentage: number
  entries: TraceabilityMatrixEntry[]
}

/** ADR-127: the matrix of one task's requirements (and its sub-tasks') instead of the whole project's. */
export interface MatrixScope {
  task_id?: string
  include_sub_tasks?: boolean
}

function matrixQuery(projectId: string, scope: MatrixScope): string {
  const query = new URLSearchParams({ project_id: projectId })
  if (scope.task_id) {
    query.set('task_id', scope.task_id)
    if (scope.include_sub_tasks) query.set('include_sub_tasks', 'true')
  }
  return query.toString()
}

export function fetchTraceabilityMatrix(projectId: string, scope: MatrixScope = {}): Promise<TraceabilityMatrixReport> {
  return apiFetch<TraceabilityMatrixReport>(`/reports/traceability-matrix?${matrixQuery(projectId, scope)}`)
}

export function traceabilityMatrixExportUrl(projectId: string, scope: MatrixScope = {}): string {
  return `${API_BASE_URL}/reports/traceability-matrix/export?${matrixQuery(projectId, scope)}`
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

// Pass 4 (ADR-065): additive to the CSV export and the browser-print view,
// a real server-generated PDF file for sharing/archiving.
export function complianceExportPdfUrl(period: CompliancePeriod = {}): string {
  const params = new URLSearchParams()
  if (period.periodFrom) params.set('period_from', period.periodFrom)
  if (period.periodTo) params.set('period_to', period.periodTo)
  const query = params.toString()
  return `${API_BASE_URL}/reports/compliance-detail/pdf${query ? `?${query}` : ''}`
}

// ADR-071: Excel exports. Paths (not absolute URLs) because they are fetched
// through `downloadFile`, which shows loading/error state instead of
// navigating the browser to the file.
export function aggregateExportXlsxPath(
  metric: Metric,
  groupBy: GroupBy,
  filters: AggregateReportFilters = {}
): string {
  return `/reports/aggregate/export.xlsx?${buildAggregateParams(metric, groupBy, filters).toString()}`
}

export function complianceExportXlsxPath(period: CompliancePeriod = {}): string {
  const params = new URLSearchParams()
  if (period.periodFrom) params.set('period_from', period.periodFrom)
  if (period.periodTo) params.set('period_to', period.periodTo)
  const query = params.toString()
  return `/reports/compliance-export.xlsx${query ? `?${query}` : ''}`
}

// Same exports as complianceExportUrl / complianceExportPdfUrl, as API paths for `downloadFile`.
export function complianceExportCsvPath(period: CompliancePeriod = {}): string {
  return complianceExportUrl(period).slice(API_BASE_URL.length)
}

export function complianceExportPdfPath(period: CompliancePeriod = {}): string {
  return complianceExportPdfUrl(period).slice(API_BASE_URL.length)
}

export function traceabilityMatrixExportXlsxPath(projectId: string, scope: MatrixScope = {}): string {
  return `/reports/traceability-matrix/export.xlsx?${matrixQuery(projectId, scope)}`
}

export type QualityRunType = 'Regression' | 'Sanity' | 'Smoke' | 'all'

export interface CycleTimeByProject {
  project_id: string
  project_name: string
  finished_run_count: number
  average_cycle_time_hours: number | null
}

export interface QualityMetricsReport {
  period_days: number
  project_id: string | null
  run_type: QualityRunType
  execution_defect_count: number
  step_linked_defect_count: number
  step_defect_precision_percentage: number | null
  finished_run_count: number
  average_cycle_time_hours: number | null
  cycle_time_by_project: CycleTimeByProject[]
  step_sample_size: number
  step_pass_percentage: number | null
  total_test_cases: number
  approved_test_cases: number
  review_gate_coverage_percentage: number | null
}

function qualityParams(days: number, projectId?: string, runType: QualityRunType = 'Regression') {
  const params = new URLSearchParams({ days: String(days), run_type: runType })
  if (projectId) params.set('project_id', projectId)
  return params.toString()
}

export function fetchQualityMetrics(
  days = 30,
  projectId?: string,
  runType: QualityRunType = 'Regression'
): Promise<QualityMetricsReport> {
  return apiFetch<QualityMetricsReport>(`/reports/quality-metrics?${qualityParams(days, projectId, runType)}`)
}

export function qualityMetricsExportXlsxPath(
  days = 30,
  projectId?: string,
  runType: QualityRunType = 'Regression'
): string {
  return `/reports/quality-metrics/export.xlsx?${qualityParams(days, projectId, runType)}`
}

export interface LeakageReleaseRow {
  release_id: string | null
  release_name: string
  project_id: string | null
  release_date: string | null
  total_defects: number
  escaped_defects: number
  leakage_percentage: number | null
  detection_effectiveness_percentage: number | null
  open_escaped_defects: number
  escaped_by_severity: Record<string, number>
}

export interface DefectLeakageReport {
  project_id: string | null
  date_from: string | null
  date_to: string | null
  total_defects: number
  escaped_defects: number
  leakage_percentage: number | null
  detection_effectiveness_percentage: number | null
  open_escaped_defects: number
  open_escaped_age_buckets: { under_7d: number; d7_to_30: number; over_30d: number }
  escaped_by_severity: Record<string, number>
  quarantined_test_cases: number
  releases: LeakageReleaseRow[]
  trend: { period: string; total_defects: number; escaped_defects: number; leakage_percentage: number | null }[]
}

function leakageParams(projectId?: string, dateFrom?: string, dateTo?: string): string {
  const params = new URLSearchParams()
  if (projectId) params.set('project_id', projectId)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function fetchDefectLeakage(projectId?: string, dateFrom?: string, dateTo?: string): Promise<DefectLeakageReport> {
  return apiFetch<DefectLeakageReport>(`/reports/defect-leakage${leakageParams(projectId, dateFrom, dateTo)}`)
}

export function defectLeakageExportXlsxPath(projectId?: string, dateFrom?: string, dateTo?: string): string {
  return `/reports/defect-leakage/export.xlsx${leakageParams(projectId, dateFrom, dateTo)}`
}

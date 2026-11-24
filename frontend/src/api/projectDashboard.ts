import { apiFetch } from '@/api/client'

// ADR-123: the project Overview. Layout endpoints store the widget order/sizes; every widget reads
// its numbers from the report endpoints below (or existing list endpoints) with this project's id.

export type WidgetSize = 'S' | 'M' | 'L'

export type ProjectWidgetType =
  | 'kpi_strip'
  | 'test_status'
  | 'execution_trend'
  | 'defect_severity'
  | 'module_coverage'
  | 'requirement_traceability'
  | 'tester_performance'
  | 'tester_workload'
  | 'release_readiness'
  | 'upcoming_milestones'
  | 'overdue_cases'
  | 'recent_defects'
  | 'my_pending'
  | 'recent_activity'

export interface ProjectLayoutWidget {
  widget_type: ProjectWidgetType
  size: WidgetSize
}

export type LayoutSource = 'user' | 'project_default' | 'builtin'

export interface ProjectLayout {
  project_id: string
  layout_source: LayoutSource
  widgets: ProjectLayoutWidget[]
  /** What "Reset" returns to: the project default when one exists, else the built-in order. */
  default_widgets: ProjectLayoutWidget[]
  has_project_default: boolean
  can_set_default: boolean
  catalogue: { widget_type: ProjectWidgetType; default_size: WidgetSize }[]
}

export const getProjectLayout = (projectId: string) =>
  apiFetch<ProjectLayout>(`/projects/${projectId}/dashboard`)
export const saveProjectLayout = (projectId: string, widgets: ProjectLayoutWidget[]) =>
  apiFetch<ProjectLayout>(`/projects/${projectId}/dashboard`, {
    method: 'PUT',
    body: JSON.stringify({ widgets }),
  })
export const resetProjectLayout = (projectId: string) =>
  apiFetch<ProjectLayout>(`/projects/${projectId}/dashboard`, { method: 'DELETE' })
export const saveProjectDefaultLayout = (projectId: string, widgets: ProjectLayoutWidget[]) =>
  apiFetch<ProjectLayout>(`/projects/${projectId}/dashboard/default`, {
    method: 'PUT',
    body: JSON.stringify({ widgets }),
  })
export const clearProjectDefaultLayout = (projectId: string) =>
  apiFetch<ProjectLayout>(`/projects/${projectId}/dashboard/default`, { method: 'DELETE' })

// --- report aggregates -------------------------------------------------------------------

export interface ProjectTestStatus {
  project_id: string
  total: number
  executed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  not_run: number
  execution_percentage: number | null
  pass_rate: number | null
}

export interface ModuleCoverageRow {
  module_id: string | null
  module_name: string
  total: number
  executed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  not_run: number
  coverage_percentage: number | null
}

export interface TesterPerformanceRow {
  user_id: string | null
  user_name: string | null
  executed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  pass_rate: number | null
  defects_raised: number
}

export interface OverdueRunCaseRow {
  run_case_id: string
  run_id: string
  run_name: string
  test_case_id: string
  test_case_display_id: string | null
  title: string
  status: string
  assignee_id: string | null
  assignee_name: string | null
  due_date: string
  days_overdue: number
}

export interface MilestoneRow {
  kind: 'release' | 'run_due'
  id: string
  name: string
  milestone_date: string
  days_until: number
  detail: string | null
  open_cases: number | null
}

const q = (projectId: string) => `?project_id=${encodeURIComponent(projectId)}`

export const fetchProjectTestStatus = (projectId: string) =>
  apiFetch<ProjectTestStatus>(`/reports/project-test-status${q(projectId)}`)
export const fetchModuleCoverage = (projectId: string) =>
  apiFetch<{ project_id: string; rows: ModuleCoverageRow[] }>(`/reports/module-coverage${q(projectId)}`)
export const fetchTesterPerformance = (projectId: string) =>
  apiFetch<{ project_id: string; rows: TesterPerformanceRow[] }>(`/reports/tester-performance${q(projectId)}`)
export const fetchOverdueRunCases = (projectId: string) =>
  apiFetch<{ project_id: string; total: number; items: OverdueRunCaseRow[] }>(
    `/reports/overdue-run-cases${q(projectId)}`,
  )
export const fetchUpcomingMilestones = (projectId: string) =>
  apiFetch<{ project_id: string; items: MilestoneRow[] }>(`/reports/upcoming-milestones${q(projectId)}`)

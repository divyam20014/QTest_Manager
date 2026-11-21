import { apiFetch } from '@/api/client'
import type { TestCaseListResponse } from '@/api/testCases'

// ADR-099: custom dashboards. The API stores layouts only; every widget reads
// its data from the existing report / dashboard endpoints.

export type WidgetSize = 'S' | 'M' | 'L'

export type WidgetType =
  | 'kpi_summary'
  | 'execution_trend'
  | 'status_distribution'
  | 'defect_aging'
  | 'open_defects_by_severity'
  | 'release_readiness'
  | 'defect_leakage'
  | 'flaky_tests'
  | 'recent_activity'
  | 'saved_report'
  | 'my_assigned_cases'

export type WidgetSettings = Record<string, string | number>

export interface DashboardWidget {
  id: string
  widget_type: WidgetType
  size: WidgetSize
  position: number
  settings: WidgetSettings
  /** 'denied' when the viewer can no longer see the widget's project. */
  project_access: 'ok' | 'denied'
}

export interface DashboardSummaryItem {
  id: string
  name: string
  is_team_default: boolean
  is_owner: boolean
  can_edit: boolean
  widget_count: number
  updated_at: string | null
}

export interface DashboardDetail extends DashboardSummaryItem {
  widgets: DashboardWidget[]
}

export interface WidgetDraft {
  widget_type: WidgetType
  size: WidgetSize
  settings: WidgetSettings
}

export const MAX_DASHBOARDS = 10
export const MAX_WIDGETS = 12

export const listDashboards = () => apiFetch<DashboardSummaryItem[]>('/dashboards')
export const getDashboard = (id: string) => apiFetch<DashboardDetail>(`/dashboards/${id}`)
export const createDashboard = (name: string) =>
  apiFetch<DashboardDetail>('/dashboards', { method: 'POST', body: JSON.stringify({ name }) })
export const renameDashboard = (id: string, name: string) =>
  apiFetch<DashboardDetail>(`/dashboards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
export const deleteDashboard = (id: string) =>
  apiFetch<{ deleted: boolean }>(`/dashboards/${id}`, { method: 'DELETE' })
export const replaceDashboardWidgets = (id: string, widgets: WidgetDraft[]) =>
  apiFetch<DashboardDetail>(`/dashboards/${id}/widgets`, {
    method: 'PUT',
    body: JSON.stringify({ widgets }),
  })
export const setTeamDefault = (id: string, enabled: boolean) =>
  apiFetch<DashboardDetail | { removed: boolean }>(`/dashboards/${id}/team-default`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })

/** Test cases assigned to the signed-in user (existing listing endpoints). */
export function fetchMyAssignedCases(userId: string, projectId?: string): Promise<TestCaseListResponse> {
  const q = new URLSearchParams({ assignee_id: userId, page_size: '10' })
  const path = projectId ? `/projects/${projectId}/test-cases` : '/test-cases'
  return apiFetch<TestCaseListResponse>(`${path}?${q.toString()}`)
}

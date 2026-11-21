import { apiFetch } from '@/api/client'

export type SourceKey = 'test_cases' | 'test_runs' | 'defects'
export type FieldType = 'text' | 'enum' | 'id' | 'number' | 'date' | 'bool'
export type Operator = 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null'

export interface SourceField {
  key: string
  label: string
  type: FieldType
  operators: Operator[]
  sortable: boolean
  groupable: boolean
  options: string[]
}

export interface SourceMeta {
  key: SourceKey
  label: string
  fields: SourceField[]
}

export type FilterValue = string | number | boolean | Array<string | number> | null

export interface ReportFilter {
  field: string
  op: Operator
  value?: FilterValue
}

export interface ReportDefinition {
  source: SourceKey
  fields: string[]
  filters: ReportFilter[]
  group_by: string[]
  sort?: { field: string; dir: 'asc' | 'desc' } | null
}

export interface ReportColumn {
  key: string
  label: string
  type: FieldType
}

export type ReportRow = Record<string, string | number | boolean | null>

export interface ReportResult {
  columns: ReportColumn[]
  rows: ReportRow[]
  total: number
  page: number
  page_size: number
}

export interface SavedReport {
  id: string
  name: string
  source: SourceKey
  definition: ReportDefinition
  is_shared: boolean
  owner_id: string
  owner_name: string
  is_owner: boolean
  can_edit: boolean
  created_at: string
  updated_at: string | null
}

export const fetchReportSources = () => apiFetch<SourceMeta[]>('/report-builder/sources')

export const previewReport = (definition: ReportDefinition, page: number, pageSize: number) =>
  apiFetch<ReportResult>('/report-builder/preview', {
    method: 'POST',
    body: JSON.stringify({ definition, page, page_size: pageSize }),
  })

export const listSavedReports = () => apiFetch<SavedReport[]>('/report-builder/reports')

export const createSavedReport = (name: string, definition: ReportDefinition, isShared: boolean) =>
  apiFetch<SavedReport>('/report-builder/reports', {
    method: 'POST',
    body: JSON.stringify({ name, definition, is_shared: isShared }),
  })

export const updateSavedReport = (
  id: string,
  req: Partial<{
    name: string
    definition: ReportDefinition
    is_shared: boolean
  }>,
) =>
  apiFetch<SavedReport>(`/report-builder/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })

export const deleteSavedReport = (id: string) =>
  apiFetch<{ deleted: boolean }>(`/report-builder/reports/${id}`, {
    method: 'DELETE',
  })

export const runSavedReport = (id: string, page: number, pageSize: number) =>
  apiFetch<ReportResult>(`/report-builder/reports/${id}/run?page=${page}&page_size=${pageSize}`, {
    method: 'POST',
  })

export const reportExportPath = (id: string, ext: 'csv' | 'xlsx') => `/report-builder/reports/${id}/export.${ext}`

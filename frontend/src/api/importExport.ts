import { apiFetch } from '@/api/client'

/** ADR-120: standard import (template, preview, commit) for test cases and defects. */

export type ImportKind = 'test_case' | 'defect' | 'requirement'
export type ImportMode = 'all_or_nothing' | 'skip_invalid'
export type RowStatus = 'valid' | 'warning' | 'error'

export interface ImportIssue {
  column: string | null
  message: string
}

export interface PreviewRow {
  row_number: number
  status: RowStatus
  errors: ImportIssue[]
  warnings: ImportIssue[]
  data: Record<string, string>
}

export interface PreviewIssue {
  row_number: number
  severity: 'error' | 'warning'
  column: string | null
  message: string
}

export interface PreviewTotals {
  rows: number
  valid: number
  warnings: number
  errors: number
  importable: number
}

export interface ImportPreview {
  token: string
  expires_at: string
  kind: ImportKind
  project_id: string
  filename: string | null
  file_type: 'csv' | 'xlsx'
  totals: PreviewTotals
  async_commit: boolean
  file_warnings: string[]
  unknown_columns: string[]
  ignored_columns: string[]
  modules_to_create: string[]
  preview_columns: { key: string; label: string }[]
  rows: PreviewRow[]
  rows_shown: number
  issues: PreviewIssue[]
  issues_truncated: boolean
}

export interface PreviewRowsPage {
  total: number
  offset: number
  rows: PreviewRow[]
}

export interface CommitSummary {
  async: false
  created: number
  skipped: number
  failed: number
  total_rows: number
  modules_created: number
  mode: ImportMode
  errors: { row_number: number; column: string | null; message: string }[]
  ids: { row_number: number; id: string; display_id: string }[]
  batch_id: string
}

export interface CommitQueued {
  async: true
  job_id: string
  status: string
}

export interface ImportJob {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error: string | null
  result: (Omit<CommitSummary, 'async'> & { async: true }) | null
}

const BASE: Record<ImportKind, string> = { test_case: '/test-cases', defect: '/defects', requirement: '/requirements' }

export function templatePath(kind: ImportKind, format: 'xlsx' | 'csv'): string {
  return `${BASE[kind]}/import-template.${format}`
}

export function templateFallbackName(kind: ImportKind, format: 'xlsx' | 'csv'): string {
  return `${kind}_import_template.${format}`
}

export function previewImport(kind: ImportKind, projectId: string, file: File): Promise<ImportPreview> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('file', file)
  return apiFetch<ImportPreview>(`${BASE[kind]}/import/preview`, { method: 'POST', body: form })
}

export function fetchPreviewRows(
  kind: ImportKind,
  token: string,
  params: { status: 'all' | 'valid' | 'warning' | 'error' | 'issues'; offset: number; limit: number },
): Promise<PreviewRowsPage> {
  const query = new URLSearchParams({
    status: params.status,
    offset: String(params.offset),
    limit: String(params.limit),
  })
  return apiFetch<PreviewRowsPage>(`${BASE[kind]}/import/preview/${token}/rows?${query.toString()}`)
}

export function commitImport(
  kind: ImportKind,
  token: string,
  mode: ImportMode,
): Promise<CommitSummary | CommitQueued> {
  return apiFetch<CommitSummary | CommitQueued>(`${BASE[kind]}/import/commit`, {
    method: 'POST',
    body: JSON.stringify({ token, mode }),
  })
}

export function getImportJob(kind: ImportKind, jobId: string): Promise<ImportJob> {
  return apiFetch<ImportJob>(`${BASE[kind]}/import/status/${jobId}`)
}

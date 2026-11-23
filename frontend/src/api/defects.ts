import { apiFetch } from '@/api/client'

// Tier 5 / ADR-055: tenant-configurable value set (app/services/field_option_service.py)
// -- no longer a fixed literal union. The four defaults every tenant is
// seeded with still work as plain strings; `string` just stops pretending
// a tenant-added option like "Blocker" is a type error.
export type Severity = string
// Pass 2 (ADR-061): same tenant-configurable value set mechanism as
// severity, 'defect_priority' field_key.
export type Priority = string
// ADR-118: eleven codes (Open and Verified are the legacy ones).
export type DefectStatus =
  | 'New'
  | 'Open'
  | 'Fixed'
  | 'Verified'
  | 'Closed'
  | 'Assigned'
  | 'In Progress'
  | 'Retest'
  | 'Reopened'
  | 'Rejected'
  | 'Deferred'
/** ADR-118: how a Closed / Rejected / Deferred defect ended. */
export type Resolution = 'Fixed' | 'Duplicate' | "Won't Fix" | 'Cannot Reproduce' | 'By Design' | 'Not Applicable'
export type Verdict = 'pass' | 'fail' | 'ignore'
export type RootCause =
  | 'requirements_gap'
  | 'code_defect'
  | 'design_flaw'
  | 'test_data_issue'
  | 'environment_issue'
  | 'third_party_integration'
  | 'other'

export interface DefectLink {
  id: string
  linkable_type: 'execution_step' | 'test_case' | 'defect' | 'test_run_case'
  linkable_id: string
  link_type: 'relates_to' | 'duplicate_of' | 'caused_by'
  created_at: string
}

export interface ExecutionEvidence {
  execution_step_id: string
  test_run_case_id: string
  verdict: Verdict | null
  opened_at: string | null
  closed_at: string | null
  duration_ms: number | null
  executed_by: string | null
  executed_by_name: string | null
}

/** One step to reproduce (ADR-118); numbered 1..n by the server from list order. */
export interface ReproStep {
  step_no?: number
  action: string
  test_data?: string | null
  expected_result?: string | null
  /** Set on the step that failed when the defect was raised from an execution. */
  failed?: boolean
}

/** A test case linked to a defect, with its latest execution (GET /defects/{id}/test-cases). */
export interface LinkedTestCase {
  id: string
  display_id: string | null
  title: string
  module_name: string | null
  module_path: string | null
  is_primary: boolean
  latest_execution_status: string
  latest_execution_at: string | null
  latest_executed_by: string | null
  latest_executed_by_name: string | null
  test_run_id: string | null
  test_run_name: string | null
  test_run_case_id: string | null
  raised_from_run_case_id: string | null
  linked_at: string | null
}

export interface Defect {
  id: string
  project_id: string
  project_name: string
  test_case_id: string | null
  test_case_title: string | null
  test_case_version_id: string | null
  test_case_version_number: number | null
  test_run_id: string | null
  test_run_name: string | null
  test_run_case_id: string | null
  test_case_version_step_id: string | null
  step_number: number | null
  title: string
  severity: Severity
  priority: Priority
  status: DefectStatus
  status_label: string
  description: string | null
  steps_to_reproduce: string | null
  actual_result: string | null
  expected_result: string | null
  environment: string | null
  environment_id: string | null
  environment_name: string | null
  found_in_build_id: string | null
  found_in_build_name: string | null
  fixed_in_release_id: string | null
  fixed_in_release_name: string | null
  root_cause: RootCause | null
  module_id: string | null
  module_name: string | null
  assigned_to: string | null
  assigned_to_name: string | null
  reported_by: string
  reported_by_name: string | null
  created_at: string
  closed_at: string | null
  age_days: number
  sla_breached: boolean
  reopened_count: number
  last_reopened_at: string | null
  links: DefectLink[]
  execution_evidence: ExecutionEvidence | null
  custom_fields: Record<string, unknown>
  // ADR-115 / ADR-118: the 22-field standard.
  display_id: string | null
  preconditions: string | null
  resolution: Resolution | null
  labels: string[]
  repro_steps: ReproStep[] | null
  build_found: string | null
  fix_version: string | null
  root_cause_notes: string | null
  reporter: string | null
  assignee: string | null
  date_reported: string | null
  attachment_count: number
  linked_test_cases: LinkedTestCase[]
  linked_test_case_count: number
}

export interface PossibleDuplicate {
  defect_id: string
  title: string
  status: DefectStatus
  similarity: number
}

export interface DefectHistoryEntry {
  id: string
  action: string
  user_id: string | null
  user_name: string | null
  event_metadata: Record<string, unknown>
  /** ADR-118: `{field: {from, to}}` lifted out of the event metadata. */
  changes: Record<string, { from: unknown; to: unknown }>
  created_at: string
}

export interface DefectCreateRequest {
  execution_step_id?: string
  test_run_case_id?: string
  project_id?: string
  test_run_id?: string
  test_case_id?: string | null
  test_case_ids?: string[]
  title?: string
  severity?: Severity
  priority?: Priority
  status?: DefectStatus
  description?: string
  preconditions?: string | null
  repro_steps?: ReproStep[]
  actual_result?: string
  expected_result?: string
  environment?: string
  build_found?: string | null
  fix_version?: string | null
  root_cause?: RootCause | null
  root_cause_notes?: string | null
  labels?: string[]
  module_id?: string | null
  assigned_to?: string | null
  copy_evidence?: boolean
}

export interface DefectUpdateRequest {
  title?: string
  severity?: Severity
  priority?: Priority
  description?: string
  preconditions?: string | null
  repro_steps?: ReproStep[]
  actual_result?: string | null
  expected_result?: string | null
  environment?: string | null
  build_found?: string | null
  fix_version?: string | null
  resolution?: Resolution | null
  root_cause?: RootCause | null
  root_cause_notes?: string | null
  labels?: string[]
  assigned_to?: string | null
  module_id?: string | null
}

export interface DefectLinkCreateRequest {
  linkable_type: 'execution_step' | 'test_case' | 'defect' | 'test_run_case'
  linkable_id: string
  link_type?: 'relates_to' | 'duplicate_of' | 'caused_by'
}

/** The plain (unpaged) listing's filters, kept for the screens that read a small related set. */
export interface DefectFilters {
  project_id?: string
  status?: DefectStatus
  severity?: Severity
  test_run_id?: string
  reported_by?: string
  created_from?: string
  created_to?: string
  test_case_id?: string
}

/** Every filter of the list, the status counts and the export (ADR-118). Multi-value fields are arrays. */
export interface DefectListFilters {
  search?: string
  project_id?: string
  status?: string[]
  severity?: string[]
  priority?: string[]
  labels?: string[]
  assignee_id?: string
  reported_by?: string
  module_id?: string
  test_case_id?: string
  created_from?: string
  created_to?: string
  fix_version?: string
  environment?: string
  resolution?: string
}

export interface DefectPageParams extends DefectListFilters {
  sort?: string
  page?: number
  page_size: number
}

export interface DefectPage {
  items: Defect[]
  total: number
}

export interface DefectStatusCounts {
  counts: Record<string, number>
  total: number
}

/** `GET /defects/columns` (ADR-118): the 22 fields, defaults, sorts, statuses with transitions, resolutions. */
export interface DefectFieldSpec {
  key: string
  label: string
  type: string
  group: string
  sortable: boolean
  filterable: boolean
  editable: boolean
  mandatory_on_create: boolean
  default_visible: boolean
}

export interface DefectFieldCatalog {
  fields: DefectFieldSpec[]
  default_columns: string[]
  sortable: string[]
  filters: string[]
  statuses: string[]
  resolutions: string[]
  transitions: Record<string, string[]>
  export_columns: string[]
}

/** One retest of a defect: a run case of a Retest run (`GET /defects/{id}/retests`). */
export interface DefectRetest {
  test_run_id: string
  test_run_name: string
  test_run_case_id: string
  test_case_id: string
  test_case_display_id: string | null
  test_case_title: string
  run_case_status: string
  assigned_to: string | null
  assigned_to_name: string | null
  executed_by: string | null
  executed_by_name: string | null
  executed_at: string | null
  result: string | null
  result_recorded_at: string | null
  created_at: string
}

export interface DefectRetestStarted {
  defect_id: string
  status: DefectStatus
  test_run_id: string
  test_run_name: string
  run_case_ids: string[]
  test_case_ids: string[]
}

export interface DefectRetestResult {
  defect_id: string
  result: 'pass' | 'fail'
  status: DefectStatus
  closed: boolean
  reopened_count: number
}

/** A defect that is linked to a test case or run case (`GET /test-cases/{id}/defects`). */
export interface DefectOfCase {
  id: string
  display_id: string | null
  title: string
  status: DefectStatus
  severity: Severity
  priority: Priority
  assigned_to: string | null
  assigned_to_name: string | null
}

/** `GET /test-run-cases/{id}/defect-draft`: a prefilled defect for a failed execution. Nothing is stored. */
export interface DefectDraft {
  project_id: string
  test_run_case_id: string
  test_run_id: string
  test_run_name: string
  test_case_id: string
  test_case_display_id: string | null
  test_case_title: string
  test_case_version_number: number
  title: string
  description: string
  module_id: string | null
  module_name: string | null
  module_path: string | null
  preconditions: string | null
  repro_steps: { step_no: number; action: string; test_data: string | null; expected_result: string | null; failed: boolean }[]
  failing_step_no: number | null
  failing_execution_step_id: string | null
  expected_result: string | null
  actual_result: string | null
  environment: string | null
  build_found: string | null
  tester_id: string | null
  tester_name: string | null
  executed_at: string | null
  run_case_status: string
  evidence: { attachment_id: string; file_name: string; size_bytes: number; execution_step_id: string }[]
  existing_defects: DefectOfCase[]
}

/** Query string of the list, status counts and export for a set of filters (arrays are comma separated). */
export function defectFilterQuery(filters: DefectListFilters): URLSearchParams {
  const query = new URLSearchParams()
  const scalars: (keyof DefectListFilters)[] = [
    'search',
    'project_id',
    'assignee_id',
    'reported_by',
    'module_id',
    'test_case_id',
    'created_from',
    'created_to',
    'fix_version',
    'environment',
    'resolution',
  ]
  for (const key of scalars) {
    const value = filters[key]
    if (typeof value === 'string' && value !== '') query.set(key, value)
  }
  for (const key of ['status', 'severity', 'priority', 'labels'] as const) {
    const values = filters[key]
    if (values && values.length > 0) query.set(key, values.join(','))
  }
  return query
}

function pageQuery(params: DefectPageParams): string {
  const query = defectFilterQuery(params)
  if (params.sort) query.set('sort', params.sort)
  if (params.page) query.set('page', String(params.page))
  query.set('page_size', String(params.page_size))
  return `?${query.toString()}`
}

export function listDefectsPage(params: DefectPageParams): Promise<DefectPage> {
  return apiFetch<DefectPage>(`/defects${pageQuery(params)}`)
}

export function getDefectStatusCounts(filters: Omit<DefectListFilters, 'status'> = {}): Promise<DefectStatusCounts> {
  const qs = defectFilterQuery(filters).toString()
  return apiFetch<DefectStatusCounts>(`/defects/status-counts${qs ? `?${qs}` : ''}`)
}

export function getDefectColumns(): Promise<DefectFieldCatalog> {
  return apiFetch<DefectFieldCatalog>('/defects/columns')
}

/**
 * Path of `GET /defects/export.csv|xlsx` for the current filtered set and sort. `columns` limits it to
 * the shown columns (omit for all 22 fields plus Root Cause Notes); `ids` exports just those rows (max 2,000).
 */
export function defectExportPath(
  format: 'csv' | 'xlsx',
  filters: DefectListFilters = {},
  options: { sort?: string; columns?: string[]; ids?: string[] } = {},
): string {
  const query = defectFilterQuery(filters)
  if (options.sort) query.set('sort', options.sort)
  if (options.columns && options.columns.length > 0) query.set('columns', options.columns.join(','))
  if (options.ids && options.ids.length > 0) query.set('ids', options.ids.join(','))
  const qs = query.toString()
  return `/defects/export.${format}${qs ? `?${qs}` : ''}`
}

export function listDefects(filters: DefectFilters = {}): Promise<Defect[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return apiFetch<Defect[]>(`/defects${query ? `?${query}` : ''}`)
}

export function getDefect(id: string): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}`)
}

export function getDefectHistory(id: string): Promise<DefectHistoryEntry[]> {
  return apiFetch<DefectHistoryEntry[]>(`/defects/${id}/history`)
}

export function getPossibleDuplicates(id: string): Promise<PossibleDuplicate[]> {
  return apiFetch<PossibleDuplicate[]>(`/defects/${id}/possible-duplicates`)
}

export function setDefectEnvironment(id: string, environmentId: string | null): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/environment`, {
    method: 'PATCH',
    body: JSON.stringify({ environment_id: environmentId }),
  })
}

export function updateDefectBuildRelease(
  id: string,
  foundInBuildId: string | null,
  fixedInReleaseId: string | null,
): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/build-release`, {
    method: 'PATCH',
    body: JSON.stringify({
      found_in_build_id: foundInBuildId,
      fixed_in_release_id: fixedInReleaseId,
    }),
  })
}

export function createDefect(req: DefectCreateRequest): Promise<Defect> {
  return apiFetch<Defect>('/defects', { method: 'POST', body: JSON.stringify(req) })
}

export interface DefectStatusChange {
  status: DefectStatus
  resolution?: Resolution | null
  comment?: string
  /** Closing needs this explicit gesture (ADR-118). */
  verification_confirmed?: boolean
}

export function updateDefectStatus(id: string, change: DefectStatusChange): Promise<Defect> {
  const { status, resolution, comment, verification_confirmed } = change
  return apiFetch<Defect>(`/defects/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      verification_confirmed: verification_confirmed ?? false,
      ...(resolution ? { resolution } : {}),
      ...(comment ? { comment } : {}),
    }),
  })
}

export function reopenDefect(id: string): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/reopen`, { method: 'POST' })
}

export function addDefectLink(id: string, req: DefectLinkCreateRequest): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/links`, { method: 'POST', body: JSON.stringify(req) })
}

export function updateDefectRootCause(id: string, rootCause: RootCause | null): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}/root-cause`, {
    method: 'PATCH',
    body: JSON.stringify({ root_cause: rootCause }),
  })
}

export function updateDefect(id: string, req: DefectUpdateRequest): Promise<Defect> {
  return apiFetch<Defect>(`/defects/${id}`, { method: 'PATCH', body: JSON.stringify(req) })
}

/** ADR-070: soft delete (Admin/Manager). */
export function deleteDefect(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/defects/${id}`, { method: 'DELETE' })
}

// ---- test case links (ADR-118: one link model, both directions) ---------------------------

export function listDefectTestCases(id: string): Promise<LinkedTestCase[]> {
  return apiFetch<LinkedTestCase[]>(`/defects/${id}/test-cases`)
}

export function linkTestCase(defectId: string, testCaseId: string): Promise<unknown> {
  return apiFetch(`/defects/${defectId}/test-cases/${testCaseId}`, { method: 'POST' })
}

export function unlinkTestCase(defectId: string, testCaseId: string): Promise<unknown> {
  return apiFetch(`/defects/${defectId}/test-cases/${testCaseId}`, { method: 'DELETE' })
}

export function listDefectsOfTestCase(testCaseId: string): Promise<DefectOfCase[]> {
  return apiFetch<DefectOfCase[]>(`/test-cases/${testCaseId}/defects`)
}

// ---- from an execution -----------------------------------------------------------------------

export function getDefectDraft(runCaseId: string): Promise<DefectDraft> {
  return apiFetch<DefectDraft>(`/test-run-cases/${runCaseId}/defect-draft`)
}

export function linkDefectToRunCase(runCaseId: string, defectId: string): Promise<unknown> {
  return apiFetch(`/test-run-cases/${runCaseId}/defects/${defectId}`, { method: 'POST' })
}

// ---- retest ------------------------------------------------------------------------------------

export function startDefectRetest(
  id: string,
  req: { tester_id?: string | null; name?: string; comment?: string } = {},
): Promise<DefectRetestStarted> {
  const body = { ...(req.tester_id ? { tester_id: req.tester_id } : {}), ...(req.name ? { name: req.name } : {}), ...(req.comment ? { comment: req.comment } : {}) }
  return apiFetch<DefectRetestStarted>(`/defects/${id}/retest`, { method: 'POST', body: JSON.stringify(body) })
}

export function recordRetestResult(
  id: string,
  req: { result: 'pass' | 'fail'; run_case_id: string; comment?: string },
): Promise<DefectRetestResult> {
  return apiFetch<DefectRetestResult>(`/defects/${id}/retest-result`, { method: 'POST', body: JSON.stringify(req) })
}

export function listDefectRetests(id: string): Promise<DefectRetest[]> {
  return apiFetch<DefectRetest[]>(`/defects/${id}/retests`)
}

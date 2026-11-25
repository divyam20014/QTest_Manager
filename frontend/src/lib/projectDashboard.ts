import type { ProjectLayoutWidget, ProjectWidgetType, WidgetSize } from '@/api/projectDashboard'
import { DEFECT_STATUSES } from '@/lib/defectWorkflow'

// ADR-123: pure helpers for the configurable project Overview, kept out of the components so the
// layout maths and the "link lands on a list that applies the filter" rules are unit-tested.

export type WidgetGroup = 'Summary' | 'Analytics' | 'Operations'

export interface WidgetMeta {
  label: string
  description: string
  group: WidgetGroup
  /** Reads a /reports/* endpoint that a Tester may be refused when Reports are hidden. */
  needsReports: boolean
}

export const WIDGET_META: Record<ProjectWidgetType, WidgetMeta> = {
  kpi_strip: {
    label: 'Key numbers',
    description: 'Test cases by execution result, open and critical defects.',
    group: 'Summary',
    needsReports: false,
  },
  test_status: {
    label: 'Pass / fail distribution',
    description: 'Test cases by their latest execution result.',
    group: 'Analytics',
    needsReports: false,
  },
  execution_trend: {
    label: 'Test execution trend',
    description: 'Step passes and failures per day over 30 days.',
    group: 'Analytics',
    needsReports: true,
  },
  defect_severity: {
    label: 'Defect severity',
    description: 'Open defects by severity.',
    group: 'Analytics',
    needsReports: false,
  },
  module_coverage: {
    label: 'Module-wise coverage',
    description: 'Per module: test cases, executed and passed.',
    group: 'Analytics',
    needsReports: false,
  },
  requirement_traceability: {
    label: 'Requirement traceability',
    description: 'Requirements that have at least one linked test case.',
    group: 'Analytics',
    needsReports: false,
  },
  task_progress: {
    label: 'Task progress',
    description: 'Tasks by status, what is overdue or due soon and what nobody owns.',
    group: 'Summary',
    needsReports: false,
  },
  tester_performance: {
    label: 'Tester performance',
    description: 'Per tester: executed, pass rate and defects raised.',
    group: 'Analytics',
    needsReports: true,
  },
  tester_workload: {
    label: 'Tester workload',
    description: 'Assigned cases, pending run cases and open defects per person.',
    group: 'Analytics',
    needsReports: true,
  },
  release_readiness: {
    label: 'Release readiness',
    description: 'Execution, pass rate, coverage and open defects for the latest release.',
    group: 'Analytics',
    needsReports: true,
  },
  upcoming_milestones: {
    label: 'Upcoming milestones',
    description: 'Releases and run due dates coming up.',
    group: 'Operations',
    needsReports: false,
  },
  overdue_cases: {
    label: 'Overdue test cases',
    description: 'Run cases past their due date and not yet executed.',
    group: 'Operations',
    needsReports: false,
  },
  recent_defects: {
    label: 'Recently reported defects',
    description: 'The latest defects raised in this project.',
    group: 'Operations',
    needsReports: false,
  },
  my_pending: {
    label: 'My pending activities',
    description: 'Your open run cases in this project.',
    group: 'Operations',
    needsReports: false,
  },
  recent_activity: {
    label: 'Recent activity',
    description: 'What changed in this project lately.',
    group: 'Operations',
    needsReports: true,
  },
}

/** The built-in layout, mirroring `PROJECT_WIDGET_CATALOGUE` in `app/schemas/dashboards.py`. The API
 * is the authority; this is the fallback when the layout request fails, so the Overview still shows
 * its numbers. */
export const DEFAULT_LAYOUT: ProjectLayoutWidget[] = [
  { widget_type: 'kpi_strip', size: 'L' },
  { widget_type: 'test_status', size: 'S' },
  { widget_type: 'execution_trend', size: 'M' },
  { widget_type: 'defect_severity', size: 'S' },
  { widget_type: 'module_coverage', size: 'M' },
  { widget_type: 'requirement_traceability', size: 'S' },
  { widget_type: 'task_progress', size: 'M' },
  { widget_type: 'tester_performance', size: 'M' },
  { widget_type: 'tester_workload', size: 'M' },
  { widget_type: 'upcoming_milestones', size: 'S' },
  { widget_type: 'release_readiness', size: 'M' },
  { widget_type: 'my_pending', size: 'S' },
  { widget_type: 'overdue_cases', size: 'M' },
  { widget_type: 'recent_activity', size: 'S' },
  { widget_type: 'recent_defects', size: 'L' },
]

// --- layout editing ------------------------------------------------------------------------

export interface DraftWidget {
  widget_type: ProjectWidgetType
  size: WidgetSize
  visible: boolean
}

export interface CatalogueEntry {
  widget_type: ProjectWidgetType
  default_size: WidgetSize
}

/** The draft the Customise panel edits: the layout's widgets (visible, in order) followed by every
 * other catalogue widget (hidden, in catalogue order). */
export function toDraft(widgets: ProjectLayoutWidget[], catalogue: CatalogueEntry[]): DraftWidget[] {
  const known = new Set(catalogue.map((c) => c.widget_type))
  const seen = new Set<ProjectWidgetType>()
  const out: DraftWidget[] = []
  for (const w of widgets) {
    if (!known.has(w.widget_type) || seen.has(w.widget_type)) continue
    seen.add(w.widget_type)
    out.push({ widget_type: w.widget_type, size: w.size, visible: true })
  }
  for (const c of catalogue) {
    if (!seen.has(c.widget_type)) out.push({ widget_type: c.widget_type, size: c.default_size, visible: false })
  }
  return out
}

/** What is stored: the visible widgets in draft order (a hidden widget is simply absent). */
export function fromDraft(draft: DraftWidget[]): ProjectLayoutWidget[] {
  return draft.filter((d) => d.visible).map((d) => ({ widget_type: d.widget_type, size: d.size }))
}

export function moveDraft(draft: DraftWidget[], index: number, delta: -1 | 1): DraftWidget[] {
  const to = index + delta
  if (index < 0 || index >= draft.length || to < 0 || to >= draft.length) return draft
  const next = [...draft]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}

export function setDraftVisible(draft: DraftWidget[], type: ProjectWidgetType, visible: boolean): DraftWidget[] {
  return draft.map((d) => (d.widget_type === type ? { ...d, visible } : d))
}

export function sameLayout(a: ProjectLayoutWidget[], b: ProjectLayoutWidget[]): boolean {
  return a.length === b.length && a.every((w, i) => w.widget_type === b[i].widget_type && w.size === b[i].size)
}

// --- links ---------------------------------------------------------------------------------

/** The Defects list's "Open" tab: every status that is not Closed or Rejected. */
export const OPEN_DEFECT_STATUS_PARAM = DEFECT_STATUSES.filter((s) => s !== 'Closed' && s !== 'Rejected').join(',')

type TestCaseFilter = {
  executionStatus?: 'Pass' | 'Fail' | 'Blocked' | 'Not Run' | 'Executed'
  moduleId?: string
  executedBy?: string
  assigneeId?: string
}

/** Test cases tab of the project, filtered with keys TestCasesList reads from the URL. */
export function testCasesLink(projectId: string, f: TestCaseFilter = {}): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v)
  const qs = p.toString()
  return `/projects/${projectId}/test-cases${qs ? `?${qs}` : ''}`
}

type DefectFilter = { open?: boolean; severity?: string; reportedBy?: string }

/** Defects list for the project, filtered with keys DefectsList reads from the URL. */
export function defectsLink(projectId: string, f: DefectFilter = {}): string {
  const p = new URLSearchParams({ projectId })
  if (f.open) p.set('status', OPEN_DEFECT_STATUS_PARAM)
  if (f.severity) p.set('severity', f.severity)
  if (f.reportedBy) p.set('reportedBy', f.reportedBy)
  return `/defects?${p.toString()}`
}

/** Execution Console queue narrowed to the project (and to overdue run cases). */
export function executionLink(projectId: string, overdue = false): string {
  const p = new URLSearchParams({ projectId })
  if (overdue) p.set('overdue', '1')
  return `/execution?${p.toString()}`
}

export function percentLabel(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${Math.round(value * 10) / 10}%`
}

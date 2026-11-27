import type { WidgetSettings, WidgetSize, WidgetType } from '@/api/dashboards'

// ADR-099: the fixed widget catalogue. Settings kinds map 1:1 to the typed,
// validated settings on the API (extra keys are rejected there).
export type SettingKind = 'project' | 'days' | 'top_n' | 'report'

export interface SettingField {
  kind: SettingKind
  required?: boolean
}

export interface WidgetDef {
  type: WidgetType
  label: string
  description: string
  /** Reads /reports/* (hidden from Testers when the tenant hides Reports). */
  needsReports: boolean
  fields: SettingField[]
  defaults: WidgetSettings
}

export const WIDGET_CATALOGUE: WidgetDef[] = [
  {
    type: 'kpi_summary',
    label: 'Summary tiles',
    description: 'Active projects, approved test cases, step pass rate and critical defects.',
    needsReports: false,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'execution_trend',
    label: 'Execution trend',
    description: 'Daily passed and failed executions over the last 7, 14, 30 or 90 days.',
    needsReports: true,
    fields: [{ kind: 'days' }, { kind: 'project' }],
    defaults: { days: 30 },
  },
  {
    type: 'status_distribution',
    label: 'Test case status',
    description: 'How many test cases are Draft, In review or Approved.',
    needsReports: true,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'defect_aging',
    label: 'Defect aging',
    description: 'Open defects by severity and how many have breached their SLA.',
    needsReports: true,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'open_defects_by_severity',
    label: 'Open defects by severity',
    description: 'Open defects per severity, plus the count of defects in each status.',
    needsReports: false,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'release_readiness',
    label: 'Release readiness',
    description: 'Execution, pass rate, open defects and coverage for a whole project.',
    needsReports: true,
    fields: [{ kind: 'project', required: true }],
    defaults: {},
  },
  {
    type: 'defect_leakage',
    label: 'Defect leakage',
    description: 'Share of defects found after release, with detection effectiveness.',
    needsReports: true,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'flaky_tests',
    label: 'Flaky tests',
    description: 'The test cases whose results flip most often in a project.',
    needsReports: true,
    fields: [{ kind: 'project', required: true }, { kind: 'top_n' }],
    defaults: { top_n: 10 },
  },
  {
    type: 'recent_activity',
    label: 'Recent activity',
    description: 'The latest events across the projects you can see.',
    needsReports: false,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
  {
    type: 'saved_report',
    label: 'Saved report',
    description: 'The first 10 rows of a report saved in the Report builder.',
    needsReports: true,
    fields: [{ kind: 'report', required: true }],
    defaults: {},
  },
  {
    type: 'my_assigned_cases',
    label: 'My assigned test cases',
    description: 'Test cases assigned to you, optionally in one project.',
    needsReports: false,
    fields: [{ kind: 'project' }],
    defaults: {},
  },
]

export const WIDGET_BY_TYPE = Object.fromEntries(WIDGET_CATALOGUE.map((d) => [d.type, d])) as Record<
  WidgetType,
  WidgetDef
>

export const SIZE_LABEL: Record<WidgetSize, string> = {
  S: 'Small (1 column)',
  M: 'Medium (2 columns)',
  L: 'Large (3 columns)',
}

/** Whether every required setting is present. */
export function settingsComplete(def: WidgetDef, settings: WidgetSettings): boolean {
  return def.fields.every((f) => {
    if (!f.required) return true
    const key = f.kind === 'report' ? 'report_id' : 'project_id'
    return !!settings[key]
  })
}

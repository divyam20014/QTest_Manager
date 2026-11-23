// Column modes of the Defect list (ADR-118 / ADR-119): default (the ten of GET /defects/columns),
// all (the 22 fields) and custom, driven by the same shared logic as the Test Case list.
import type { DefectFieldSpec } from '@/api/defects'
import { createColumnModel } from '@/lib/columnModes'

export type { ColumnMode, ColumnPrefs } from '@/lib/columnModes'

function extra(key: string, label: string, group: string): DefectFieldSpec {
  return {
    key,
    label,
    type: 'text',
    group,
    sortable: false,
    filterable: false,
    editable: false,
    mandatory_on_create: false,
    default_visible: false,
  }
}

/** Optional columns outside the 22-field standard (UI only; they are not part of the export). */
export const EXTRA_COLUMNS: DefectFieldSpec[] = [extra('project', 'Project', 'identity'), extra('sla', 'SLA / Age', 'workflow')]

/** Fallback when the catalogue has not loaded: the ten default columns, in order. */
export const FALLBACK_DEFAULT_COLUMNS = [
  'display_id',
  'title',
  'module',
  'severity',
  'priority',
  'status',
  'reporter',
  'assignee',
  'date_reported',
  'fix_version',
]

const model = createColumnModel<DefectFieldSpec>({
  extras: EXTRA_COLUMNS,
  fallbackDefaults: FALLBACK_DEFAULT_COLUMNS,
  storagePrefix: 'qtesthub:defect-columns',
})

export const {
  allFieldKeys,
  defaultKeys,
  pickerColumns,
  resolveColumns,
  modeForKeys,
  prefsForKeys,
  toggleColumn,
  setMode,
  readColumnPrefs,
} = model

/** Column choice of the Defect list (per user in this browser; a saved view overrides it). */
export const useDefectColumns = model.useColumns

/** Column key to the `sort=` key of the API; null when the API cannot sort by it. */
export function defectSortKey(columnKey: string, sortable: readonly string[]): string | null {
  return sortable.includes(columnKey) ? columnKey : null
}

/** The shown columns that the export endpoints know (the UI-only extras are dropped). */
export function exportColumnKeys(keys: string[], exportable: readonly string[] | undefined): string[] {
  const allowed = new Set(exportable ?? FALLBACK_EXPORT_KEYS)
  return keys.filter((k) => allowed.has(k))
}

const FALLBACK_EXPORT_KEYS = [...FALLBACK_DEFAULT_COLUMNS]

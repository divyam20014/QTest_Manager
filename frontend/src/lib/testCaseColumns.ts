// Column modes of the Test Case list (ADR-115 / ADR-117): default (the nine of
// GET /test-cases/columns), all (the 22 fields) and custom. The logic is shared with the Defect
// list (lib/columnModes.ts); this file only holds what is specific to test cases: the two extra
// UI-only columns ("Review Status" is the lifecycle status under its product name), the fallback
// defaults, the storage key and the sort / export key mapping.
import type { TestCaseFieldSpec } from '@/api/testCases'
import { createColumnModel } from '@/lib/columnModes'

export type { ColumnMode, ColumnPrefs } from '@/lib/columnModes'

/** Optional columns outside the 22-field standard. */
export const EXTRA_COLUMNS: TestCaseFieldSpec[] = [
  {
    key: 'review_status',
    label: 'Review Status',
    type: 'enum',
    group: 'lifecycle',
    sortable: true,
    filterable: true,
    editable: false,
    mandatory_on_create: false,
    default_visible: false,
  },
  {
    key: 'assignee',
    label: 'Assignee',
    type: 'user',
    group: 'lifecycle',
    sortable: false,
    filterable: true,
    editable: true,
    mandatory_on_create: false,
    default_visible: false,
  },
]

/** Fallback when the catalogue has not loaded (the nine defaults, in order). */
export const FALLBACK_DEFAULT_COLUMNS = [
  'display_id',
  'title',
  'module',
  'test_type',
  'priority',
  'automation_status',
  'execution_status',
  'executed_by',
  'last_executed_at',
]

const model = createColumnModel<TestCaseFieldSpec>({
  extras: EXTRA_COLUMNS,
  fallbackDefaults: FALLBACK_DEFAULT_COLUMNS,
  storagePrefix: 'qtesthub:test-case-columns',
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

/** Column choice of the Test Case list (per user in this browser; a saved view overrides it). */
export const useTestCaseColumns = model.useColumns

/** Sort key the API understands for a column (review_status is the lifecycle `status`). */
export function sortKeyFor(columnKey: string): string {
  return columnKey === 'review_status' ? 'status' : columnKey
}

/** Column key to `columns=` key of the export endpoints (same names, except review_status). */
export function exportKeyFor(columnKey: string): string {
  return columnKey === 'review_status' ? 'status' : columnKey
}

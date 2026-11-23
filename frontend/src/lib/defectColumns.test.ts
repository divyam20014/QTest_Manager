import { describe, expect, it } from 'vitest'

import type { DefectFieldCatalog, DefectFieldSpec } from '@/api/defects'
import {
  FALLBACK_DEFAULT_COLUMNS,
  defectSortKey,
  exportColumnKeys,
  modeForKeys,
  pickerColumns,
  prefsForKeys,
  resolveColumns,
  setMode,
  toggleColumn,
} from './defectColumns'

const KEYS = [
  'display_id', 'title', 'description', 'module', 'preconditions', 'repro_steps', 'expected_result', 'actual_result',
  'attachments', 'environment', 'build_found', 'severity', 'priority', 'status', 'resolution', 'root_cause', 'reporter',
  'assignee', 'date_reported', 'fix_version', 'linked_issues', 'labels',
]

function spec(key: string): DefectFieldSpec {
  return {
    key,
    label: key,
    type: 'text',
    group: 'g',
    sortable: false,
    filterable: false,
    editable: false,
    mandatory_on_create: false,
    default_visible: FALLBACK_DEFAULT_COLUMNS.includes(key),
  }
}

const catalog: DefectFieldCatalog = {
  fields: KEYS.map(spec),
  default_columns: FALLBACK_DEFAULT_COLUMNS,
  sortable: ['display_id', 'title', 'severity', 'priority', 'status', 'assignee', 'date_reported', 'created_at', 'fix_version'],
  filters: [],
  statuses: [],
  resolutions: [],
  transitions: {},
  export_columns: [...KEYS, 'root_cause_notes'],
}

describe('defect column modes', () => {
  it('default shows the ten standard columns, all shows the 22 fields', () => {
    expect(FALLBACK_DEFAULT_COLUMNS).toEqual([
      'display_id', 'title', 'module', 'severity', 'priority', 'status', 'reporter', 'assignee', 'date_reported', 'fix_version',
    ])
    expect(resolveColumns(catalog, { mode: 'default', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
    const all = resolveColumns(catalog, { mode: 'all', custom: [] })
    expect(all).toEqual(KEYS)
    expect(all).toHaveLength(22)
  })

  it('works before the catalogue has loaded', () => {
    expect(resolveColumns(undefined, { mode: 'default', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
  })

  it('custom shows the chosen keys in catalogue order, ignoring unknown keys, never empty', () => {
    expect(resolveColumns(catalog, { mode: 'custom', custom: ['status', 'title', 'nope'] })).toEqual(['title', 'status'])
    expect(resolveColumns(catalog, { mode: 'custom', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
  })

  it('ticking a column switches to custom from what is shown; the last one cannot go', () => {
    const next = toggleColumn(catalog, { mode: 'default', custom: [] }, 'labels')
    expect(next.mode).toBe('custom')
    expect(resolveColumns(catalog, next)).toContain('labels')
    expect(resolveColumns(catalog, next)).toHaveLength(11)
    const one = { mode: 'custom' as const, custom: ['title'] }
    expect(toggleColumn(catalog, one, 'title')).toBe(one)
  })

  it('switching to custom keeps the current selection', () => {
    expect(setMode(catalog, { mode: 'all', custom: [] }, 'custom').custom).toEqual(KEYS)
  })

  it('a saved view\'s columns map back to a mode', () => {
    expect(modeForKeys(catalog, [...FALLBACK_DEFAULT_COLUMNS].reverse())).toBe('default')
    expect(modeForKeys(catalog, KEYS)).toBe('all')
    expect(modeForKeys(catalog, ['title', 'labels'])).toBe('custom')
    expect(prefsForKeys(catalog, ['title', 'labels', 'bogus'])).toEqual({ mode: 'custom', custom: ['title', 'labels'] })
    expect(prefsForKeys(catalog, ['bogus'])).toEqual({ mode: 'default', custom: [] })
  })

  it('offers Project and SLA as UI-only extras beside the 22 fields, never exported', () => {
    const keys = pickerColumns(catalog).map((c) => c.key)
    expect(keys.slice(0, 22)).toEqual(KEYS)
    expect(keys).toEqual(expect.arrayContaining(['project', 'sla']))
    const shown = resolveColumns(catalog, { mode: 'custom', custom: ['title', 'project', 'sla', 'status'] })
    expect(shown).toEqual(['title', 'status', 'project', 'sla'])
    expect(exportColumnKeys(shown, catalog.export_columns)).toEqual(['title', 'status'])
  })

  it('sorting is limited to what the API sorts by', () => {
    expect(defectSortKey('severity', catalog.sortable)).toBe('severity')
    expect(defectSortKey('date_reported', catalog.sortable)).toBe('date_reported')
    expect(defectSortKey('module', catalog.sortable)).toBeNull()
    expect(defectSortKey('labels', catalog.sortable)).toBeNull()
  })
})

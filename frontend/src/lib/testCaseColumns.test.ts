import { describe, expect, it } from 'vitest'

import type { TestCaseFieldCatalog, TestCaseFieldSpec } from '@/api/testCases'
import {
  FALLBACK_DEFAULT_COLUMNS,
  exportKeyFor,
  modeForKeys,
  pickerColumns,
  prefsForKeys,
  resolveColumns,
  setMode,
  sortKeyFor,
  toggleColumn,
} from './testCaseColumns'

const KEYS = [
  'display_id', 'requirement_ref', 'module', 'title', 'description', 'test_type', 'priority', 'severity',
  'automation_status', 'environment', 'preconditions', 'test_data', 'steps', 'expected_result', 'postconditions',
  'actual_result', 'execution_status', 'linked_defects', 'created_by', 'executed_by', 'last_executed_at', 'attachments',
]

function spec(key: string): TestCaseFieldSpec {
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

const catalog: TestCaseFieldCatalog = {
  fields: KEYS.map(spec),
  default_columns: FALLBACK_DEFAULT_COLUMNS,
  sortable: ['title'],
  filters: [],
  automation_statuses: [],
  execution_statuses: [],
}

describe('test case column modes', () => {
  it('default shows the nine standard columns, all shows the 22 fields', () => {
    expect(resolveColumns(catalog, { mode: 'default', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
    expect(FALLBACK_DEFAULT_COLUMNS).toHaveLength(9)
    const all = resolveColumns(catalog, { mode: 'all', custom: [] })
    expect(all).toEqual(KEYS)
    expect(all).toHaveLength(22)
  })

  it('works before the catalogue has loaded (falls back to the nine)', () => {
    expect(resolveColumns(undefined, { mode: 'all', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
    expect(resolveColumns(undefined, { mode: 'default', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
  })

  it('custom shows the chosen keys in catalogue order, ignoring unknown keys, never empty', () => {
    expect(resolveColumns(catalog, { mode: 'custom', custom: ['severity', 'title', 'nope'] })).toEqual(['title', 'severity'])
    expect(resolveColumns(catalog, { mode: 'custom', custom: [] })).toEqual(FALLBACK_DEFAULT_COLUMNS)
  })

  it('ticking a column from default switches to custom starting from what is shown', () => {
    const next = toggleColumn(catalog, { mode: 'default', custom: [] }, 'severity')
    expect(next.mode).toBe('custom')
    expect(resolveColumns(catalog, next)).toEqual(
      [...FALLBACK_DEFAULT_COLUMNS, 'severity'].sort((a, b) => KEYS.indexOf(a) - KEYS.indexOf(b)),
    )
    const fewer = toggleColumn(catalog, { mode: 'all', custom: [] }, 'description')
    expect(fewer.custom).toHaveLength(21)
    expect(fewer.custom).not.toContain('description')
  })

  it('the last column cannot be unticked', () => {
    const one = { mode: 'custom' as const, custom: ['title'] }
    expect(toggleColumn(catalog, one, 'title')).toBe(one)
  })

  it('switching to custom keeps the current selection; back to default shows the nine', () => {
    const all = setMode(catalog, { mode: 'all', custom: [] }, 'custom')
    expect(all.custom).toEqual(KEYS)
    const back = setMode(catalog, { mode: 'custom', custom: ['title'] }, 'default')
    expect(back.mode).toBe('default')
    expect(resolveColumns(catalog, back)).toEqual(FALLBACK_DEFAULT_COLUMNS)
  })

  it('the keys of a saved view map back to a mode', () => {
    expect(modeForKeys(catalog, [...FALLBACK_DEFAULT_COLUMNS].reverse())).toBe('default')
    expect(modeForKeys(catalog, KEYS)).toBe('all')
    expect(modeForKeys(catalog, ['title', 'severity'])).toBe('custom')
    expect(prefsForKeys(catalog, ['title', 'severity', 'bogus'])).toEqual({ mode: 'custom', custom: ['title', 'severity'] })
    expect(prefsForKeys(catalog, ['bogus'])).toEqual({ mode: 'default', custom: [] })
  })

  it('offers Review Status and Assignee as optional extras beside the 22 fields', () => {
    const keys = pickerColumns(catalog).map((c) => c.key)
    expect(keys.slice(0, 22)).toEqual(KEYS)
    expect(keys).toContain('review_status')
    expect(resolveColumns(catalog, { mode: 'custom', custom: ['title', 'review_status'] })).toEqual(['title', 'review_status'])
  })

  it('maps column keys to the API sort and export keys', () => {
    expect(sortKeyFor('review_status')).toBe('status')
    expect(exportKeyFor('review_status')).toBe('status')
    expect(exportKeyFor('last_executed_at')).toBe('last_executed_at')
  })
})

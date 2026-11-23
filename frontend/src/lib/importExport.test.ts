import { describe, expect, it } from 'vitest'

import type { PreviewIssue, PreviewRow, PreviewTotals } from '@/api/importExport'
import {
  buildErrorReportCsv,
  checkImportFile,
  isQueued,
  nextPollDelay,
  planCommit,
  plural,
  previewAnnouncement,
  previewExpired,
  resultHeadline,
  rowIssueText,
  summaryChips,
  visibleRows,
} from '@/lib/importExport'

const totals = (over: Partial<PreviewTotals> = {}): PreviewTotals => ({
  rows: 10,
  valid: 7,
  warnings: 1,
  errors: 2,
  importable: 8,
  ...over,
})

const row = (n: number, status: PreviewRow['status']): PreviewRow => ({
  row_number: n,
  status,
  errors: status === 'error' ? [{ column: 'Title', message: 'Too short' }] : [],
  warnings: status === 'warning' ? [{ column: null, message: 'Same title as row 2' }] : [],
  data: {},
})

describe('checkImportFile', () => {
  it('accepts xlsx and csv in any case', () => {
    expect(checkImportFile({ name: 'cases.XLSX', size: 10 })).toBeNull()
    expect(checkImportFile({ name: 'cases.csv', size: 10 })).toBeNull()
  })
  it('refuses macros, other types, empty and oversize files', () => {
    expect(checkImportFile({ name: 'a.xlsm', size: 10 })).toMatch(/Macro/)
    expect(checkImportFile({ name: 'a.txt', size: 10 })).toMatch(/\.xlsx or \.csv/)
    expect(checkImportFile({ name: 'a.csv', size: 0 })).toMatch(/empty/)
    expect(checkImportFile({ name: 'a.csv', size: 11 * 1024 * 1024 })).toMatch(/10 MB/)
  })
})

describe('summary text', () => {
  it('pluralises with thousands separators', () => {
    expect(plural(1, 'row')).toBe('1 row')
    expect(plural(5000, 'test case')).toBe('5,000 test cases')
  })
  it('builds the chips in valid / warnings / errors order', () => {
    expect(summaryChips(totals()).map((c) => [c.key, c.count, c.tone])).toEqual([
      ['valid', 7, 'positive'],
      ['warnings', 1, 'warning'],
      ['errors', 2, 'critical'],
    ])
  })
  it('announces the preview for a screen reader', () => {
    expect(previewAnnouncement(totals())).toBe('10 rows checked, 7 valid, 1 warning, 2 errors.')
    expect(previewAnnouncement(totals({ warnings: 0, errors: 0, valid: 10 }))).toBe(
      '10 rows checked, 10 valid, no errors.',
    )
  })
  it('titles the result', () => {
    expect(resultHeadline({ created: 3, skipped: 0 }, 'defect')).toBe('3 defects imported')
    expect(resultHeadline({ created: 1, skipped: 2 }, 'defect')).toBe(
      '1 defect imported, 2 rows skipped',
    )
  })
})

describe('rows and the error report', () => {
  it('filters to the rows with problems', () => {
    const rows = [row(2, 'valid'), row(3, 'error'), row(4, 'warning')]
    expect(visibleRows(rows, true).map((r) => r.row_number)).toEqual([3, 4])
    expect(visibleRows(rows, false)).toHaveLength(3)
  })
  it('joins errors and warnings of a row', () => {
    const both: PreviewRow = { ...row(5, 'error'), warnings: [{ column: null, message: 'W' }] }
    expect(rowIssueText(both)).toBe('Title: Too short | W')
  })
  it('writes a csv with the file row numbers, quoting and a formula guard', () => {
    const issues: PreviewIssue[] = [
      { row_number: 3, severity: 'error', column: 'Title', message: 'Needs, a "comma"' },
      { row_number: 4, severity: 'warning', column: null, message: '=SUM(A1)' },
    ]
    expect(buildErrorReportCsv(issues).split('\r\n')).toEqual([
      'Row,Severity,Column,Message',
      '3,error,Title,"Needs, a ""comma"""',
      "4,warning,,'=SUM(A1)",
      '',
    ])
  })
})

describe('planCommit', () => {
  it('blocks all-or-nothing while rows have errors', () => {
    const plan = planCommit(totals(), 'all_or_nothing')
    expect(plan.allowed).toBe(false)
    expect(plan.blockedReason).toMatch(/2 rows have errors/)
    expect(plan.willImport).toBe(0)
  })
  it('imports the valid rows and skips the rest in skip-invalid mode', () => {
    const plan = planCommit(totals(), 'skip_invalid')
    expect(plan).toMatchObject({ allowed: true, willImport: 8, willSkip: 2, blockedReason: null })
  })
  it('allows a clean file in either mode and refuses an empty one', () => {
    const clean = totals({ errors: 0, importable: 10, valid: 9 })
    expect(planCommit(clean, 'all_or_nothing')).toMatchObject({ allowed: true, willImport: 10 })
    const none = totals({ importable: 0, errors: 10, valid: 0, warnings: 0 })
    expect(planCommit(none, 'skip_invalid').allowed).toBe(false)
  })
  it('says "has" for a single bad row', () => {
    expect(planCommit(totals({ errors: 1 }), 'all_or_nothing').blockedReason).toMatch(/1 row has/)
  })
})

describe('commit result and timing helpers', () => {
  it('tells a queued job from a finished import', () => {
    expect(isQueued({ async: true, job_id: 'j', status: 'queued' })).toBe(true)
    expect(
      isQueued({
        async: false,
        created: 1,
        skipped: 0,
        failed: 0,
        total_rows: 1,
        modules_created: 0,
        mode: 'all_or_nothing',
        errors: [],
        ids: [],
        batch_id: 'b',
      }),
    ).toBe(false)
  })
  it('knows when a preview token has expired', () => {
    const preview = { expires_at: '2026-01-01T10:30:00Z' }
    expect(previewExpired(preview, Date.parse('2026-01-01T10:00:00Z'))).toBe(false)
    expect(previewExpired(preview, Date.parse('2026-01-01T10:30:00Z'))).toBe(true)
  })
  it('backs off the polling up to four seconds', () => {
    expect(nextPollDelay(0)).toBe(1000)
    expect(nextPollDelay(2)).toBe(2000)
    expect(nextPollDelay(50)).toBe(4000)
  })
})

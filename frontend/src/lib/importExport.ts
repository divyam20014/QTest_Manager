import type {
  CommitQueued,
  CommitSummary,
  ImportMode,
  ImportPreview,
  PreviewIssue,
  PreviewRow,
  PreviewTotals,
} from '@/api/importExport'

/** Pure helpers of the import wizard (ADR-120): file checks, summary text, the error
 * report, the choice of commit mode and what the result screen says. */

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024
export const IMPORT_EXTENSIONS = ['.xlsx', '.csv'] as const

/** A message when the file cannot be sent, else null. The server checks again. */
export function checkImportFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsm') || name.endsWith('.xlsb')) {
    return 'Macro-enabled workbooks are not accepted. Save the file as .xlsx or .csv.'
  }
  if (!IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Choose a .xlsx or .csv file.'
  if (file.size === 0) return 'The file is empty.'
  if (file.size > IMPORT_MAX_BYTES) return 'The file is larger than the 10 MB limit.'
  return null
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export interface SummaryChip {
  key: 'valid' | 'warnings' | 'errors'
  label: string
  count: number
  tone: 'positive' | 'warning' | 'critical'
}

export function summaryChips(totals: PreviewTotals): SummaryChip[] {
  return [
    { key: 'valid', label: 'Valid', count: totals.valid, tone: 'positive' },
    { key: 'warnings', label: 'Warnings', count: totals.warnings, tone: 'warning' },
    { key: 'errors', label: 'Errors', count: totals.errors, tone: 'critical' },
  ]
}

/** One sentence for screen readers when the preview arrives. */
export function previewAnnouncement(totals: PreviewTotals): string {
  const parts = [`${plural(totals.rows, 'row')} checked`, `${totals.valid} valid`]
  if (totals.warnings) parts.push(plural(totals.warnings, 'warning'))
  parts.push(totals.errors ? plural(totals.errors, 'error') : 'no errors')
  return parts.join(', ') + '.'
}

export function rowIssueText(row: PreviewRow): string {
  return [...row.errors, ...row.warnings]
    .map((i) => (i.column ? `${i.column}: ${i.message}` : i.message))
    .join(' | ')
}

/** The rows to show: all of them, or only those with an error or a warning. */
export function visibleRows(rows: PreviewRow[], issuesOnly: boolean): PreviewRow[] {
  return issuesOnly ? rows.filter((r) => r.status !== 'valid') : rows
}

function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value)
  // Keep a spreadsheet from running a cell that starts like a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The downloadable error report: one line per problem, with the row number of the file. */
export function buildErrorReportCsv(issues: PreviewIssue[]): string {
  const lines = ['Row,Severity,Column,Message']
  for (const issue of issues) {
    lines.push(
      [issue.row_number, issue.severity, issue.column, issue.message].map(csvCell).join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

export interface CommitPlan {
  /** Rows that will be created in the chosen mode. */
  willImport: number
  /** Rows left out because they have errors. */
  willSkip: number
  allowed: boolean
  /** Why the import button is disabled, or null. */
  blockedReason: string | null
}

export function planCommit(totals: PreviewTotals, mode: ImportMode): CommitPlan {
  if (mode === 'all_or_nothing') {
    if (totals.errors > 0) {
      return {
        willImport: 0,
        willSkip: totals.errors,
        allowed: false,
        blockedReason: `${plural(totals.errors, 'row')} ${totals.errors === 1 ? 'has' : 'have'} errors. Fix the file and upload it again, or choose to skip the invalid rows.`,
      }
    }
    return { willImport: totals.importable, willSkip: 0, allowed: totals.importable > 0, blockedReason: totals.importable > 0 ? null : 'There are no rows to import.' }
  }
  return {
    willImport: totals.importable,
    willSkip: totals.errors,
    allowed: totals.importable > 0,
    blockedReason: totals.importable > 0 ? null : 'There are no valid rows to import.',
  }
}

export function isQueued(result: CommitSummary | CommitQueued): result is CommitQueued {
  return result.async === true
}

/** The headline of the result screen. */
export function resultHeadline(summary: Pick<CommitSummary, 'created' | 'skipped'>, noun: string): string {
  const created = plural(summary.created, noun)
  return summary.skipped > 0
    ? `${created} imported, ${plural(summary.skipped, 'row')} skipped`
    : `${created} imported`
}

export function previewExpired(preview: Pick<ImportPreview, 'expires_at'>, now = Date.now()): boolean {
  return new Date(preview.expires_at).getTime() <= now
}

/** Poll delay for an async import: quick at first, then every few seconds. */
export function nextPollDelay(attempt: number): number {
  return Math.min(1000 + attempt * 500, 4000)
}

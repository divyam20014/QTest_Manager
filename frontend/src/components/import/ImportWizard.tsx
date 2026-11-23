import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from 'lucide-react'

import { ApiError, downloadFile } from '@/api/client'
import {
  commitImport,
  fetchPreviewRows,
  getImportJob,
  previewImport,
  templateFallbackName,
  templatePath,
  type CommitSummary,
  type ImportKind,
  type ImportMode,
  type ImportPreview,
} from '@/api/importExport'
import type { ImportReport } from '@/api/csvImport'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CsvDropZone } from '@/components/ui/csv-drop-zone'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import {
  buildErrorReportCsv,
  checkImportFile,
  isQueued,
  nextPollDelay,
  planCommit,
  plural,
  previewAnnouncement,
  resultHeadline,
  rowIssueText,
  summaryChips,
} from '@/lib/importExport'
import { MappedImportFlow, ImportResultPanel } from '@/routes/testcases/MappedImportFlow'

type Step = 'file' | 'review' | 'confirm' | 'result'
const STEPS: { key: Step; label: string }[] = [
  { key: 'file', label: 'Choose file' },
  { key: 'review', label: 'Review' },
  { key: 'confirm', label: 'Confirm' },
  { key: 'result', label: 'Result' },
]
const PAGE = 100

function saveCsv(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function errorFields(error: unknown): string[] {
  return error instanceof ApiError && error.fields ? Object.keys(error.fields) : []
}

const STATUS_TONE = { valid: 'positive', warning: 'warning', error: 'critical' } as const
const STATUS_LABEL = { valid: 'Valid', warning: 'Warning', error: 'Error' } as const

/**
 * ADR-120: the import wizard shared by the Test Case and Defect lists. Step 1 picks the
 * file (templates linked), step 2 shows what the server found without having written
 * anything, step 3 asks for the mode (all or nothing / skip invalid rows) and step 4 is
 * the result (a progress view while a big import runs as a background job).
 */
export function ImportWizard({
  open,
  onClose,
  kind,
  noun,
  projectId: fixedProjectId,
  projects,
  viewHref,
  allowMapped = false,
}: {
  open: boolean
  onClose: () => void
  kind: ImportKind
  /** "test case" / "defect". */
  noun: string
  /** The project of the list; without it the user picks one in step 1. */
  projectId?: string | null
  projects?: { id: string; name: string }[]
  viewHref: (projectId: string) => string
  /** Offer the legacy column-mapping import for files from other tools. */
  allowMapped?: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('file')
  const [chosenProject, setChosenProject] = useState('')
  const projectId = fixedProjectId || chosenProject
  const [file, setFile] = useState<File | null>(null)
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [issuesOnly, setIssuesOnly] = useState(true)
  const [shown, setShown] = useState(PAGE)
  const [mode, setMode] = useState<ImportMode>('all_or_nothing')
  const [jobId, setJobId] = useState<string | null>(null)
  const [summary, setSummary] = useState<Omit<CommitSummary, 'async'> | null>(null)
  const [mapped, setMapped] = useState(false)
  const [legacyReport, setLegacyReport] = useState<ImportReport | null>(null)
  const [templateBusy, setTemplateBusy] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step, mapped, legacyReport])

  function reset() {
    setStep('file')
    setChosenProject('')
    setFile(null)
    setFileProblem(null)
    setPreview(null)
    setIssuesOnly(true)
    setShown(PAGE)
    setMode('all_or_nothing')
    setJobId(null)
    setSummary(null)
    setMapped(false)
    setLegacyReport(null)
    setTemplateError(null)
    previewMutation.reset()
    commitMutation.reset()
  }

  function close() {
    reset()
    onClose()
  }

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
    void queryClient.invalidateQueries({ queryKey: ['defects'] })
    void queryClient.invalidateQueries({ queryKey: ['test-modules'] })
  }

  const previewMutation = useMutation({
    mutationFn: () => previewImport(kind, projectId, file as File),
    onSuccess: (data) => {
      setPreview(data)
      setIssuesOnly(data.totals.errors + data.totals.warnings > 0)
      setMode('all_or_nothing')
      setShown(PAGE)
      setStep('review')
    },
  })

  const commitMutation = useMutation({
    mutationFn: () => commitImport(kind, (preview as ImportPreview).token, mode),
    onSuccess: (result) => {
      if (isQueued(result)) {
        setJobId(result.job_id)
      } else {
        setSummary(result)
        refreshLists()
      }
      setStep('result')
    },
  })

  const rowsQuery = useQuery({
    queryKey: ['import-rows', preview?.token, issuesOnly, shown],
    queryFn: () =>
      fetchPreviewRows(kind, (preview as ImportPreview).token, {
        status: issuesOnly ? 'issues' : 'all',
        offset: 0,
        limit: shown,
      }),
    enabled: !!preview && step === 'review',
    placeholderData: keepPreviousData,
  })

  const jobQuery = useQuery({
    queryKey: ['import-job', kind, jobId],
    queryFn: () => getImportJob(kind, jobId as string),
    enabled: !!jobId && !summary,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'succeeded' || status === 'failed' ? false : nextPollDelay(query.state.dataUpdateCount)
    },
  })
  const job = jobQuery.data
  useEffect(() => {
    if (job?.status === 'succeeded' && job.result && !summary) {
      setSummary(job.result)
      refreshLists()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status])

  async function downloadTemplate(format: 'xlsx' | 'csv') {
    setTemplateBusy(format)
    setTemplateError(null)
    try {
      await downloadFile(templatePath(kind, format), templateFallbackName(kind, format))
    } catch {
      setTemplateError('Could not download the template. Please try again.')
    } finally {
      setTemplateBusy(null)
    }
  }

  function pickFile(next: File | null) {
    setFile(next)
    previewMutation.reset()
    setFileProblem(next ? checkImportFile(next) : null)
  }

  const previewError = previewMutation.error instanceof ApiError ? previewMutation.error.message : previewMutation.error ? 'The file could not be checked. Please try again.' : null
  const missingColumns = errorFields(previewMutation.error)
  const commitError = commitMutation.error instanceof ApiError ? commitMutation.error.message : commitMutation.error ? 'The import failed. Please try again.' : null
  const expired = commitMutation.error instanceof ApiError && commitMutation.error.status === 404
  const plan = preview ? planCommit(preview.totals, mode) : null
  const canPreview = !!file && !fileProblem && !!projectId && !previewMutation.isPending

  const stepIndex = STEPS.findIndex((s) => s.key === step)
  const headings: Record<Step, string> = {
    file: `Choose the ${noun} file`,
    review: 'Review the file',
    confirm: 'Confirm the import',
    result: summary ? resultHeadline(summary, noun) : job?.status === 'failed' ? 'The import failed' : 'Importing…',
  }

  return (
    <Dialog open={open} onClose={close} title={`Import ${noun}s`} className="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        {!mapped && !legacyReport && (
          <ol aria-label="Import steps" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {STEPS.map((s, index) => (
              <li
                key={s.key}
                aria-current={index === stepIndex ? 'step' : undefined}
                className={index === stepIndex ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}
              >
                {index + 1}. {s.label}
              </li>
            ))}
          </ol>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {step === 'review' && preview ? previewAnnouncement(preview.totals) : ''}
          {step === 'result' && summary ? resultHeadline(summary, noun) : ''}
        </div>

        {legacyReport ? (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">Import result</h3>
            <ImportResultPanel report={legacyReport} />
            <DialogFooter>
              <Button size="sm" onClick={close}>Close</Button>
            </DialogFooter>
          </>
        ) : mapped ? (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">Map the columns of a file from another tool</h3>
            <MappedImportFlow
              onImported={(report) => {
                setLegacyReport(report)
                refreshLists()
              }}
              onCancel={() => setMapped(false)}
            />
          </>
        ) : step === 'file' ? (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">{headings.file}</h3>
            <p className="text-[var(--muted-foreground)]">
              Download a template, fill one row per {noun} and upload it as .xlsx or .csv (up to 10 MB and 20,000 rows).
              Nothing is imported until you confirm.
            </p>
            <div className="flex flex-wrap gap-2">
              {(['xlsx', 'csv'] as const).map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  size="sm"
                  disabled={templateBusy !== null}
                  onClick={() => void downloadTemplate(format)}
                >
                  {templateBusy === format ? (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  {format === 'xlsx' ? 'Excel template (.xlsx)' : 'CSV template (.csv)'}
                </Button>
              ))}
            </div>
            <FormError>{templateError}</FormError>
            {!fixedProjectId && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="import-project" className="text-xs font-medium">
                  Project <span className="text-[var(--destructive)]">*</span>
                </label>
                <Select id="import-project" value={chosenProject} onChange={(e) => setChosenProject(e.target.value)}>
                  <option value="">Choose a project</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <CsvDropZone
              file={file}
              onSelect={pickFile}
              disabled={previewMutation.isPending}
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              fileLabel="an Excel or CSV file"
              inputLabel={`${noun} file to import`}
              helpText=".xlsx or .csv, up to 10 MB"
            />
            <FormError>{fileProblem}</FormError>
            {previewError && (
              <div role="alert" className="flex flex-col gap-1 rounded-md border border-[var(--destructive)] p-3 text-xs">
                <p className="font-medium text-[var(--destructive)]">{previewError}</p>
                {missingColumns.length > 0 && (
                  <ul className="list-disc pl-4">
                    {missingColumns.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {allowMapped && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Have a CSV from TestRail, Zephyr, Jira or with different column names?{' '}
                <button type="button" className="underline" onClick={() => setMapped(true)}>
                  Map its columns instead
                </button>
                .
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canPreview} onClick={() => previewMutation.mutate()}>
                {previewMutation.isPending ? 'Checking the file…' : 'Check the file'}
              </Button>
            </DialogFooter>
          </>
        ) : step === 'review' && preview ? (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
              {headings.review}
              <span className="ml-2 font-normal text-[var(--muted-foreground)]">
                {preview.filename} · {plural(preview.totals.rows, 'row')}
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-2" aria-label="Summary">
              {summaryChips(preview.totals).map((chip) => (
                <Badge key={chip.key} tone={chip.tone}>
                  {chip.label}: {chip.count.toLocaleString('en-US')}
                </Badge>
              ))}
            </div>
            {preview.file_warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
            {preview.ignored_columns.length > 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Not read (derived by the application): {preview.ignored_columns.join(', ')}.
              </p>
            )}
            {preview.modules_to_create.length > 0 && (
              <div className="rounded-md border border-[var(--border)] p-3 text-xs">
                <p className="font-medium">
                  {plural(preview.modules_to_create.length, 'module')} will be created
                </p>
                <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto">
                  {preview.modules_to_create.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-11 items-center gap-2 text-xs md:min-h-0">
                <input
                  type="checkbox"
                  checked={issuesOnly}
                  onChange={(e) => {
                    setIssuesOnly(e.target.checked)
                    setShown(PAGE)
                  }}
                />
                Show errors and warnings only
              </label>
              {preview.issues.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveCsv(buildErrorReportCsv(preview.issues), `${kind}_import_errors.csv`)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download error report (CSV)
                </Button>
              )}
            </div>
            {preview.issues_truncated && (
              <p className="text-xs text-[var(--muted-foreground)]">
                The report lists the first {preview.issues.length.toLocaleString('en-US')} problems.
              </p>
            )}
            <div className="max-h-72 overflow-auto rounded-md border border-[var(--border)]">
              {rowsQuery.isLoading ? (
                <p className="flex items-center gap-2 p-4 text-xs text-[var(--muted-foreground)]">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading rows…
                </p>
              ) : rowsQuery.isError ? (
                <p role="alert" className="p-4 text-xs text-[var(--destructive)]">
                  The rows could not be loaded.
                </p>
              ) : (rowsQuery.data?.rows.length ?? 0) === 0 ? (
                <p className="p-4 text-xs text-[var(--muted-foreground)]">
                  {issuesOnly ? 'No row has an error or a warning.' : 'The file has no rows.'}
                </p>
              ) : (
                <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                  <caption className="sr-only">Rows of the file with their check result</caption>
                  <thead className="sticky top-0 bg-[var(--muted)]">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 font-medium">Row</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Result</th>
                      {preview.preview_columns.map((c) => (
                        <th key={c.key} scope="col" className="px-2 py-1.5 font-medium">{c.label}</th>
                      ))}
                      <th scope="col" className="px-2 py-1.5 font-medium">Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsQuery.data?.rows.map((row) => (
                      <tr key={row.row_number} className="border-t border-[var(--border)] align-top">
                        <td className="px-2 py-1.5 tabular-nums">{row.row_number}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={STATUS_TONE[row.status]}>
                            {row.status === 'error' ? <XCircle className="mr-1 size-3" aria-hidden="true" /> : row.status === 'warning' ? <AlertTriangle className="mr-1 size-3" aria-hidden="true" /> : <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />}
                            {STATUS_LABEL[row.status]}
                          </Badge>
                        </td>
                        {preview.preview_columns.map((c) => (
                          <td key={c.key} className="max-w-48 truncate px-2 py-1.5" title={row.data[c.key]}>
                            {row.data[c.key]}
                          </td>
                        ))}
                        <td className="min-w-56 px-2 py-1.5">{rowIssueText(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {rowsQuery.data && rowsQuery.data.total > rowsQuery.data.rows.length && (
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>
                  Showing {rowsQuery.data.rows.length.toLocaleString('en-US')} of {rowsQuery.data.total.toLocaleString('en-US')}
                </span>
                <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Show more
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStep('file')
                  setPreview(null)
                }}
              >
                Choose another file
              </Button>
              <Button size="sm" disabled={preview.totals.importable === 0} onClick={() => setStep('confirm')}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : step === 'confirm' && preview && plan ? (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">{headings.confirm}</h3>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium">What should happen to rows with errors?</legend>
              <label className="flex min-h-11 items-start gap-2 rounded-md border border-[var(--border)] p-3 md:min-h-0">
                <input
                  type="radio"
                  name="import-mode"
                  className="mt-0.5"
                  checked={mode === 'all_or_nothing'}
                  onChange={() => setMode('all_or_nothing')}
                />
                <span>
                  <span className="font-medium">All or nothing</span> (recommended)
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Import only if every row is valid; otherwise nothing is imported.
                  </span>
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-2 rounded-md border border-[var(--border)] p-3 md:min-h-0">
                <input
                  type="radio"
                  name="import-mode"
                  className="mt-0.5"
                  checked={mode === 'skip_invalid'}
                  onChange={() => setMode('skip_invalid')}
                />
                <span>
                  <span className="font-medium">Skip invalid rows</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Import the valid rows and leave out the rows with errors.
                  </span>
                </span>
              </label>
            </fieldset>
            <p aria-live="polite" className="rounded-md bg-[var(--muted)] p-3 text-xs">
              {plan.allowed || plan.willImport > 0 ? (
                <>
                  <strong>{plural(plan.willImport, noun)}</strong> will be imported
                  {plan.willSkip > 0 && <>, {plural(plan.willSkip, 'row')} skipped</>}.
                </>
              ) : (
                plan.blockedReason
              )}
              {plan.allowed && preview.async_commit && ' This is a large file: it is imported in the background and you can follow the progress here.'}
            </p>
            {!plan.allowed && plan.blockedReason && plan.willImport === 0 && mode === 'all_or_nothing' && (
              <p role="alert" className="text-xs text-[var(--destructive)]">{plan.blockedReason}</p>
            )}
            {commitError && (
              <div role="alert" className="flex flex-col gap-2 text-xs text-[var(--destructive)]">
                <p>{commitError}</p>
                {expired && (
                  <Button variant="outline" size="sm" className="self-start" onClick={() => { setStep('file'); setPreview(null); commitMutation.reset() }}>
                    Upload the file again
                  </Button>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" disabled={commitMutation.isPending} onClick={() => setStep('review')}>
                Back
              </Button>
              <Button size="sm" disabled={!plan.allowed || commitMutation.isPending} onClick={() => commitMutation.mutate()}>
                {commitMutation.isPending ? 'Importing…' : `Import ${plural(plan.willImport, noun)}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">{headings.result}</h3>
            {summary ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="positive">Created: {summary.created.toLocaleString('en-US')}</Badge>
                  {summary.skipped > 0 && <Badge tone="warning">Skipped: {summary.skipped.toLocaleString('en-US')}</Badge>}
                  {summary.modules_created > 0 && <Badge tone="info">Modules created: {summary.modules_created}</Badge>}
                </div>
                {summary.errors.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium">Skipped rows</p>
                    <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
                      {summary.errors.slice(0, 50).map((e, index) => (
                        <li key={`${e.row_number}-${index}`} className="border-t border-[var(--border)] pt-1">
                          <span className="font-medium">Row {e.row_number}:</span> {e.column ? `${e.column}: ` : ''}{e.message}
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        saveCsv(
                          buildErrorReportCsv(summary.errors.map((e) => ({ ...e, severity: 'error' as const }))),
                          `${kind}_import_skipped.csv`,
                        )
                      }
                    >
                      <Download className="size-4" aria-hidden="true" />
                      Download error report (CSV)
                    </Button>
                  </div>
                )}
              </>
            ) : job?.status === 'failed' ? (
              <p role="alert" className="text-xs text-[var(--destructive)]">
                {job.error ?? 'The import failed.'} Nothing was imported.
              </p>
            ) : (
              <p role="status" className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {job?.status === 'running' ? 'The import is running in the background…' : 'The import is queued…'} You can keep this window open.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={close}>
                Close
              </Button>
              {summary && summary.created > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = viewHref(projectId)
                    close()
                    navigate(target)
                  }}
                >
                  View imported
                </Button>
              )}
              {job?.status === 'failed' && (
                <Button size="sm" onClick={() => { setJobId(null); setStep('confirm') }}>
                  Try again
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </div>
    </Dialog>
  )
}

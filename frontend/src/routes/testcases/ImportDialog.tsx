import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  detectTestCaseColumns,
  importTestCases,
  importTestCasesMapped,
  templateDownloadUrl,
  type ColumnDetectionResult,
  type ImportPreset,
  type ImportReport,
} from '@/api/csvImport'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'

const PRESETS: { value: ImportPreset; label: string }[] = [
  { value: 'testrail', label: 'TestRail' },
  { value: 'zephyr', label: 'Zephyr' },
  { value: 'jira', label: 'Jira / Xray' },
]

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function downloadErrorReport(report: ImportReport) {
  const lines = ['Row,Errors']
  for (const row of report.rows) {
    lines.push(`${row.row_number},${csvEscape(row.errors.join('; '))}`)
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'import_errors.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function ImportResultPanel({ report }: { report: ImportReport }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
      <div className="flex gap-3 text-xs">
        <span>Total: {report.total_rows}</span>
        <Badge tone="positive">Created: {report.created_count}</Badge>
        {report.error_count > 0 && <Badge tone="critical">Errors: {report.error_count}</Badge>}
      </div>
      {report.rows.length > 0 && (
        <>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
            {report.rows.map((row) => (
              <li key={row.row_number} className="border-t border-[var(--border)] pt-1">
                <span className="font-medium">Row {row.row_number}:</span> {row.errors.join('; ')}
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" onClick={() => downloadErrorReport(report)}>
            Download Error Report (CSV)
          </Button>
        </>
      )}
    </div>
  )
}

// Pass 3, item 2/3: flexible mapped-import flow -- any CSV, any column
// names, mapped onto QTestHub's fields. Presets (TestRail/Zephyr/Jira) only
// pre-fill a *starting point* for the mapping; the user still reviews and
// confirms every field before anything is imported.
function MappedImportFlow({
  onImported,
  onCancel,
}: {
  onImported: (report: ImportReport) => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preset, setPreset] = useState<ImportPreset | ''>('')
  const [detection, setDetection] = useState<ColumnDetectionResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const detectMutation = useMutation({
    mutationFn: ({ f, p }: { f: File; p: ImportPreset | '' }) =>
      detectTestCaseColumns(f, p || undefined),
    onSuccess: (result) => {
      setDetection(result)
      setMapping(result.suggested_mapping)
    },
  })

  const importMutation = useMutation({
    mutationFn: () => importTestCasesMapped(file as File, mapping),
    onSuccess: onImported,
  })

  const detectError = detectMutation.error instanceof ApiError ? detectMutation.error.message : null
  const importError = importMutation.error instanceof ApiError ? importMutation.error.message : null

  if (!detection) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          Upload any CSV — column names don't need to match QTestHub's exactly. You'll map each
          column to a field next.
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Preset (optional)</label>
          <Select value={preset} onChange={(e) => setPreset(e.target.value as ImportPreset | '')}>
            <option value="">None — map manually</option>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} (unverified against a real export — adjust mappings if needed)
              </option>
            ))}
          </Select>
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        {detectError && <p className="text-xs text-[var(--destructive)]">{detectError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Back
          </Button>
          <Button
            size="sm"
            disabled={!file || detectMutation.isPending}
            onClick={() => file && detectMutation.mutate({ f: file, p: preset })}
          >
            {detectMutation.isPending ? 'Reading…' : 'Next: Map Columns'}
          </Button>
        </div>
      </div>
    )
  }

  const sourceOptions = ['', ...detection.columns.map((c) => c.name)]
  const unmappedRequired = detection.required_fields.filter((f) => !mapping[f])

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-[var(--muted-foreground)]">
        Map each QTestHub field to a column from your file. Required fields are marked.
      </p>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {detection.target_fields.map((field) => {
          const required = detection.required_fields.includes(field)
          const sample = detection.columns.find((c) => c.name === mapping[field])?.sample_values[0]
          return (
            <div key={field} className="flex items-center gap-2">
              <span className="w-40 shrink-0 text-xs">
                {field}
                {required && <span className="text-[var(--destructive)]"> *</span>}
              </span>
              <Select
                className="flex-1"
                value={mapping[field] ?? ''}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [field]: e.target.value }) as Record<string, string>)
                }
              >
                {sourceOptions.map((name) => (
                  <option key={name || '__none__'} value={name}>
                    {name || '— Ignore —'}
                  </option>
                ))}
              </Select>
              {sample && (
                <span className="w-32 shrink-0 truncate text-xs text-[var(--muted-foreground)]" title={sample}>
                  e.g. "{sample}"
                </span>
              )}
            </div>
          )
        })}
      </div>
      {unmappedRequired.length > 0 && (
        <p className="text-xs text-[var(--destructive)]">
          Required fields still unmapped: {unmappedRequired.join(', ')}
        </p>
      )}
      {importError && <p className="text-xs text-[var(--destructive)]">{importError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setDetection(null)}>
          Back
        </Button>
        <Button
          size="sm"
          disabled={unmappedRequired.length > 0 || importMutation.isPending}
          onClick={() => importMutation.mutate()}
        >
          {importMutation.isPending ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </div>
  )
}

export function ImportDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
}) {
  const queryClient = useQueryClient()
  const [report, setReport] = useState<ImportReport | null>(null)
  const [mode, setMode] = useState<'standard' | 'flexible'>('standard')

  const importMutation = useMutation({
    mutationFn: (file: File) => importTestCases(file),
    onSuccess: (data) => {
      setReport(data)
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
    },
  })

  function handleClose() {
    setReport(null)
    setMode('standard')
    importMutation.reset()
    onClose()
  }

  function handleMappedImported(data: ImportReport) {
    setReport(data)
    queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
  }

  const serverError = importMutation.error instanceof ApiError ? importMutation.error.message : null

  return (
    <Dialog open={open} onClose={handleClose} title="Import Test Cases" className="max-w-xl">
      <div className="flex flex-col gap-3 text-sm">
        {report ? (
          <ImportResultPanel report={report} />
        ) : mode === 'flexible' ? (
          <MappedImportFlow onImported={handleMappedImported} onCancel={() => setMode('standard')} />
        ) : (
          <>
            <p className="text-[var(--muted-foreground)]">
              Upload a CSV with columns: Title, Module (required), Sub Module, Project Name,
              Priority, Status, Description (required), Scenario Id, Scenario Description,
              Prerequisite, Test Data, Assignee Email, Steps. Each row names its own project, so
              one file can cover multiple projects.{' '}
              <a
                href={templateDownloadUrl}
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download template
              </a>
              . Have a CSV from another tool (TestRail, Zephyr, Jira) or different column names?{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setMode('flexible')}
              >
                Use flexible import instead
              </button>
              .
            </p>

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importMutation.mutate(file)
              }}
              className="text-sm"
            />

            {importMutation.isPending && (
              <p className="text-[var(--muted-foreground)]">Importing…</p>
            )}
            {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

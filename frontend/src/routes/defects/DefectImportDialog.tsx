import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { defectTemplateDownloadUrl, importDefects, type ImportReport } from '@/api/csvImport'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast'

// Pass 2 (ADR-061): Defect bulk import, newly built -- mirrors
// routes/testcases/ImportDialog.tsx exactly.
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
  link.download = 'defect_import_errors.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function DefectImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const importMutation = useMutation({
    mutationFn: (file: File) => importDefects(file),
    onSuccess: (data) => {
      setReport(data)
      queryClient.invalidateQueries({ queryKey: ['defects'] })
      showToast(
        data.error_count > 0 ? 'error' : 'success',
        `Imported ${data.created_count} of ${data.total_rows} defect(s)${
          data.error_count > 0 ? ` — ${data.error_count} row(s) had errors` : ''
        }`,
      )
    },
    // No onError toast -- `serverError` below already renders a thrown
    // (non-per-row) error inline, avoiding the duplicate-text strict-mode-
    // locator problem confirmed by a real Playwright failure elsewhere in
    // this pass.
  })

  function handleClose() {
    setReport(null)
    importMutation.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  const serverError = importMutation.error instanceof ApiError ? importMutation.error.message : null

  return (
    <Dialog open={open} onClose={handleClose} title="Import Defects" className="max-w-xl">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          Upload a CSV with columns: Title, Project Name, Severity, Priority, Description
          (required), Steps to Reproduce, Expected Result, Actual Result, Environment, Module,
          Assignee Email.{' '}
          <a
            href={defectTemplateDownloadUrl}
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download template
          </a>
          .
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) importMutation.mutate(file)
          }}
          className="text-sm"
        />

        {importMutation.isPending && <p className="text-[var(--muted-foreground)]">Importing…</p>}
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}

        {report && (
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

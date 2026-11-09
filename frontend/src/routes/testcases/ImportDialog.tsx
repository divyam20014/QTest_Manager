import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { importTestCases, templateDownloadUrl, type ImportReport } from '@/api/csvImport'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const importMutation = useMutation({
    mutationFn: (file: File) => importTestCases(file),
    onSuccess: (data) => {
      setReport(data)
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
    },
  })

  function handleClose() {
    setReport(null)
    importMutation.reset()
    onClose()
  }

  const serverError = importMutation.error instanceof ApiError ? importMutation.error.message : null

  return (
    <Dialog open={open} onClose={handleClose} title="Import Test Cases" className="max-w-xl">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          Upload a CSV with columns: Title, Project Name, Priority, Status, Assignee Email, Steps. Each row names
          its own project, so one file can cover multiple projects.{' '}
          <a href={templateDownloadUrl} className="underline" target="_blank" rel="noopener noreferrer">
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

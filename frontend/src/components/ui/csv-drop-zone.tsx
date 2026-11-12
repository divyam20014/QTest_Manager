import { useRef, useState } from 'react'
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react'

import { cn } from '@/lib/utils'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Shared drag-and-drop CSV upload area -- used by both the Test Case and
 * Defect import flows so the upload experience (and any future polish)
 * stays in one place instead of drifting between two near-identical
 * `<input type="file">` implementations. Purely a presentation/selection
 * layer: the caller still owns validation and the actual upload call, so
 * existing import behavior is unchanged. */
export function CsvDropZone({
  file,
  onSelect,
  disabled,
  helpText,
}: {
  file: File | null
  onSelect: (file: File | null) => void
  disabled?: boolean
  helpText?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (picked) onSelect(picked)
  }

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileSpreadsheet className="size-5 shrink-0 text-[var(--brand)]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {file.type || 'text/csv'} · {formatBytes(file.size)}
            </p>
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
            aria-label="Remove selected file"
            className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        if (!disabled) handleFiles(e.dataTransfer.files)
      }}
      aria-disabled={disabled}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
        dragActive
          ? 'border-[var(--brand)] bg-[var(--brand-muted)]'
          : 'border-[var(--border)] hover:border-[var(--brand)] hover:bg-[var(--muted)]/40',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <UploadCloud className="size-7 text-[var(--muted-foreground)]" />
      <p className="text-sm font-medium">
        Drag and drop a CSV file, or <span className="text-[var(--link)] underline">browse</span>
      </p>
      {helpText && <p className="text-xs text-[var(--muted-foreground)]">{helpText}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
      />
    </div>
  )
}

import { Paperclip, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'

import { ALLOWED_ATTACHMENT_EXTENSIONS, ATTACHMENT_MAX_BYTES } from '@/api/attachments'
import { formatBytes, screenFiles } from '@/lib/attachmentFiles'
import { IconButton } from '@/components/ui/icon-button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Evidence picker for a defect that does not exist yet (the saved defect uses AttachmentsPanel):
 * files are checked against the same type and size rules as the upload, kept in the form, and
 * uploaded by the page right after the defect is created. A refused file says why, immediately.
 */
export function PendingAttachments({
  files,
  onChange,
  disabled,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [over, setOver] = useState(false)

  function add(list: File[]) {
    if (list.length === 0) return
    const result = screenFiles(list, files)
    setRejected(result.rejected)
    if (result.accepted.length > 0) onChange([...files, ...result.accepted])
  }

  function onInput(e: ChangeEvent<HTMLInputElement>) {
    add(Array.from(e.target.files ?? []))
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    if (!disabled) add(Array.from(e.dataTransfer.files ?? []))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="df-attachments-input">Attachments / Evidence</Label>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby="df-attachments-help"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
          over ? 'border-[var(--primary)] bg-[var(--muted)]' : 'border-[var(--border)] hover:bg-[var(--muted)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <input ref={inputRef} id="df-attachments-input" type="file" multiple className="hidden" onChange={onInput} />
        <Paperclip className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
        <span className="font-medium">Drag and drop screenshots or logs here, or click to browse</span>
      </div>
      <p id="df-attachments-help" className="text-xs text-[var(--muted-foreground)]">
        Allowed: {ALLOWED_ATTACHMENT_EXTENSIONS.join(' ')}. Up to {ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB per file. Files are uploaded when the
        defect is saved.
      </p>
      {rejected.length > 0 && (
        <ul role="alert" aria-label="Files not added" className="flex flex-col gap-0.5 text-xs text-[var(--destructive)]">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul aria-label="Files to upload" className="flex flex-col gap-1 text-sm">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-1.5"
            >
              <span className="min-w-0 truncate">
                {file.name} <span className="text-xs text-[var(--muted-foreground)]">{formatBytes(file.size)}</span>
              </span>
              <IconButton
                size="sm"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((f) => f !== file))}
              >
                <X aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

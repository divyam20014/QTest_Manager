import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { ApiError, downloadFile } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/lib/toast'

/**
 * "Export Excel" style button: fetches the file through the authenticated API
 * (so a refusal or failure is reported in a toast, not as a browser error
 * page), shows a busy state while the server builds the workbook, and blocks
 * double clicks.
 */
export function ExportButton({
  label = 'Export Excel',
  path,
  fallbackName,
  variant = 'outline',
  size = 'default',
  className,
  disabled,
  ariaLabel,
}: {
  label?: string
  /** API path (with query string) relative to the API base URL. */
  path: string
  fallbackName: string
  variant?: 'outline' | 'default' | 'ghost'
  size?: 'default' | 'sm'
  className?: string
  disabled?: boolean
  /** Distinguishes several identical buttons on one page for assistive tech. */
  ariaLabel?: string
}) {
  const [busy, setBusy] = useState(false)
  const { show } = useToast()

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      await downloadFile(path, fallbackName)
      show('success', 'Export downloaded')
    } catch (error) {
      const forbidden = error instanceof ApiError && error.status === 403
      show(
        'error',
        forbidden
          ? 'You do not have permission to export this.'
          : 'Could not create the export. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={run}
      disabled={disabled || busy}
      aria-busy={busy}
      aria-label={ariaLabel && !busy ? ariaLabel : undefined}
    >
      {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      {busy ? 'Preparing…' : label}
    </Button>
  )
}

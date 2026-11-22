import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { ApiError, downloadFile } from '@/api/client'
import { Button } from '@/components/ui/button'
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useToast } from '@/lib/toast'

export type ExportMenuItem =
  /** A file fetched through the authenticated API (busy state + toast, like ExportButton). */
  | { label: string; path: string; fallbackName: string }
  /** Anything else, e.g. opening the print view. */
  | { label: string; onSelect: () => void }

/**
 * One "Export" dropdown in place of a row of export buttons. File items share
 * the ExportButton behaviour: the trigger shows "Preparing..." and is disabled
 * while a file is built, success / failure (incl. 403) is reported in a toast.
 */
export function ExportMenu({
  items,
  label = 'Export',
  menuLabel,
  className,
  disabled,
}: {
  items: ExportMenuItem[]
  label?: string
  /** Accessible name of the menu, e.g. "Export compliance report". */
  menuLabel: string
  className?: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const { show } = useToast()

  async function runFile(path: string, fallbackName: string) {
    if (busy) return
    setBusy(true)
    try {
      await downloadFile(path, fallbackName)
      show('success', 'Export downloaded')
    } catch (error) {
      const forbidden = error instanceof ApiError && error.status === 403
      show(
        'error',
        forbidden ? 'You do not have permission to export this.' : 'Could not create the export. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const menuItems: DropdownMenuItem[] = items.map((item) => ({
    label: item.label,
    onSelect: 'path' in item ? () => void runFile(item.path, item.fallbackName) : item.onSelect,
  }))

  return (
    <DropdownMenu
      label={menuLabel}
      items={menuItems}
      className={className ?? 'max-md:w-full'}
      trigger={(props) => (
        <Button
          {...props}
          type="button"
          variant="outline"
          disabled={disabled || busy}
          aria-busy={busy}
          className="max-md:w-full"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {busy ? 'Preparing…' : label}
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      )}
    />
  )
}

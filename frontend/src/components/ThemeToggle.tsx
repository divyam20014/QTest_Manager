import { useState } from 'react'
import { Palette } from 'lucide-react'

import { AppearancePanel } from '@/components/AppearancePanel'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'

/** Opens the Appearance dialog (colour themes + custom palette). Header: icon only; More sheet: labelled row. */
export function ThemeToggle({ showLabel = false }: { showLabel?: boolean } = {}) {
  const [open, setOpen] = useState(false)

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Appearance"
      aria-haspopup="dialog"
      className={
        showLabel
          ? 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]'
          : 'rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
      }
    >
      <Palette className="size-4" />
      {showLabel && 'Appearance'}
    </button>
  )
  return (
    <>
      {showLabel ? button : <Tooltip content="Appearance" side="bottom">{button}</Tooltip>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Appearance" className="md:max-w-2xl">
        <AppearancePanel />
        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}

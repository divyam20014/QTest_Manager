import { useState } from 'react'
import { Palette } from 'lucide-react'

import { AppearancePanel } from '@/components/AppearancePanel'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** The Appearance dialog (colour themes + custom palette). Opened from the account menu and the phone More sheet. */
export function AppearanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Appearance" className="md:max-w-2xl">
      <AppearancePanel />
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Labelled "Appearance" row for the phone More sheet (the desktop control lives in the account menu). */
export function ThemeToggle() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Appearance"
        aria-haspopup="dialog"
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
      >
        <Palette className="size-4" />
        Appearance
      </button>
      <AppearanceDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

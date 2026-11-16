import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * Confirmation step for destructive or hard-to-reverse actions, built on the
 * shared Dialog (focus trap, Escape, return-focus, bottom sheet on phones).
 *
 * - `destructive` renders the confirm button in the destructive style.
 * - `requireText` makes the user type a phrase (typically the item's name)
 *   before the confirm button enables -- reserve it for irreversible,
 *   high-blast-radius actions such as deleting a project.
 * - The dialog stays open while `pending`; close it from the mutation's
 *   onSuccess so a failure leaves the user in place with the toast.
 */
type ConfirmProps = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  requireText?: string
  onConfirm: () => void
  onClose: () => void
}

// Rendered only while the Dialog is open (Dialog returns null when closed), so
// the typed-confirmation text resets every time the dialog is reopened.
function ConfirmBody({
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  pending = false,
  requireText,
  onConfirm,
  onClose,
}: Omit<ConfirmProps, 'title'>) {
  const [typed, setTyped] = useState('')
  const textOk = !requireText || typed.trim() === requireText
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-[var(--muted-foreground)]">{description}</p>
      {requireText && (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Type “{requireText}” to confirm
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          disabled={pending || !textOk}
          onClick={onConfirm}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function ConfirmDialog({ open, title, ...body }: ConfirmProps & { open: boolean }) {
  return (
    <Dialog open={open} onClose={body.onClose} title={title}>
      <ConfirmBody {...body} />
    </Dialog>
  )
}

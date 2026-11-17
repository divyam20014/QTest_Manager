import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Textarea } from '@/components/ui/textarea'

const MIN_LENGTH = 3
const MAX_LENGTH = 1000

// BRD "Block Case": a tester marks a test case Blocked when something outside
// the test (environment down, build missing, dependency broken) stops it from
// being executed. A reason is mandatory so whoever picks it up knows why.
export function BlockCaseDialog({
  open,
  caseTitle,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean
  caseTitle: string
  pending: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  return (
    <Dialog open={open} onClose={pending ? () => undefined : onClose} title="Block this test case">
      {/* Mounted only while open, so the form always starts empty. */}
      <BlockCaseForm caseTitle={caseTitle} pending={pending} onClose={onClose} onSubmit={onSubmit} />
    </Dialog>
  )
}

function BlockCaseForm({
  caseTitle,
  pending,
  onClose,
  onSubmit,
}: {
  caseTitle: string
  pending: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  const trimmed = reason.trim()
  const tooShort = trimmed.length < MIN_LENGTH
  const error = touched && tooShort ? `Enter a reason of at least ${MIN_LENGTH} characters.` : undefined

  function submit() {
    setTouched(true)
    if (tooShort || pending) return
    onSubmit(trimmed)
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      noValidate
    >
      <p className="text-sm text-[var(--muted-foreground)]">
        <span className="font-medium text-[var(--foreground)]">{caseTitle}</span> will be marked Blocked and no
        step results can be recorded on it until it is unblocked. The reason is shown to everyone on the run.
      </p>
      <FormField id="block-reason" label="Reason" required error={error} helper="For example: test environment is down.">
        {(field) => (
          <Textarea
            {...field}
            rows={3}
            maxLength={MAX_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            autoFocus
          />
        )}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Blocking…' : 'Block test case'}
        </Button>
      </DialogFooter>
    </form>
  )
}

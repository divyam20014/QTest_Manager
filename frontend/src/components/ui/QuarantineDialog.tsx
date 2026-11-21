import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import { quarantineTestCase } from '@/api/testCases'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/lib/toast'

function Body({ testCaseId, title, onClose }: { testCaseId: string; title: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()
  const { show } = useToast()
  const mutation = useMutation({
    mutationFn: () => quarantineTestCase(testCaseId, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['test-cases'] })
      show('success', 'Test case quarantined')
      onClose()
    },
  })
  const valid = reason.trim().length >= 3 && reason.trim().length <= 500
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-[var(--muted-foreground)]">
        “{title}” will be flagged as quarantined. It stays in existing runs and its verdicts still count; new runs can
        skip it. Quarantined cases are always reported separately so they cannot hide a failure.
      </p>
      <FormField id="quarantine-reason" label="Reason (3 to 500 characters)" required>
        {(field) => (
          <Textarea
            {...field}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Fails intermittently on the payment sandbox"
          />
        )}
      </FormField>
      <FormError>{mutation.error instanceof ApiError ? mutation.error.message : null}</FormError>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
          {mutation.isPending ? 'Quarantining…' : 'Quarantine'}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function QuarantineDialog({
  testCaseId,
  title,
  open,
  onClose,
}: {
  testCaseId: string
  title: string
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Quarantine test case">
      <Body testCaseId={testCaseId} title={title} onClose={onClose} />
    </Dialog>
  )
}

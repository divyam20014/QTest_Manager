import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { createDefect, type Severity } from '@/api/defects'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const SEVERITIES: Severity[] = ['Low', 'Medium', 'High', 'Critical']

/** FR-EXEC-003: marking a step Fail immediately offers to report a defect,
 * pre-populated server-side from the execution step (project/test
 * case/version/run/step traceability + an auto-suggested title). */
export function DefectQuickCreateDialog({
  open,
  onClose,
  executionStepId,
}: {
  open: boolean
  onClose: () => void
  executionStepId: string | null
}) {
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [description, setDescription] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createDefect({ execution_step_id: executionStepId!, severity, description: description || undefined }),
    onSuccess: () => {
      setDescription('')
      setSeverity('Medium')
      onClose()
    },
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="Report Defect">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          A defect will be linked to this exact step, with a title auto-suggested from the failed action.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defect-severity">Severity</Label>
          <Select id="defect-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defect-description">Description</Label>
          <Input
            id="defect-description"
            placeholder="What went wrong?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Skip
          </Button>
          <Button size="sm" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Reporting…' : 'Report Defect'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

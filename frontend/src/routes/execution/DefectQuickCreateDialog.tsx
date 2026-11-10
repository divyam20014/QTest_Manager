import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { addDefectLink, createDefect, listDefects, type Severity } from '@/api/defects'
import { ApiError } from '@/api/client'
import { listFieldOptions } from '@/api/fieldCustomization'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export interface FailedStepContext {
  executionStepId: string
  projectId: string
  projectName: string
  runName: string
  testCaseTitle: string
  stepNumber: number
  action: string
  expected: string
}

/** FR-EXEC-003 / FR-DEF spec C: marking a step Fail immediately offers to
 * either report a new defect (prepopulated and visible, not just carried
 * as hidden ids) or link the failure to an existing defect. */
export function DefectQuickCreateDialog({
  open,
  onClose,
  context,
}: {
  open: boolean
  onClose: () => void
  context: FailedStepContext | null
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Report Defect" className="max-w-lg">
      {context && (
        // Keyed by the failing step so each new failure remounts with
        // fresh initial state (suggested title/expected result) computed
        // directly, instead of syncing it in via an effect.
        <DefectQuickCreateForm key={context.executionStepId} context={context} onClose={onClose} />
      )}
    </Dialog>
  )
}

function DefectQuickCreateForm({
  context,
  onClose,
}: {
  context: FailedStepContext
  onClose: () => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [title, setTitle] = useState(`Step ${context.stepNumber} Failed: ${context.action}`)
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [description, setDescription] = useState('')
  const [actualResult, setActualResult] = useState('')
  const [expectedResult, setExpectedResult] = useState(context.expected)
  const [environment, setEnvironment] = useState('')
  const [existingDefectId, setExistingDefectId] = useState('')

  const existingDefectsQuery = useQuery({
    queryKey: ['defects', 'linkable', context.projectId],
    queryFn: () => listDefects({ project_id: context.projectId }),
    enabled: mode === 'existing',
  })
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createDefect({
        execution_step_id: context.executionStepId,
        title,
        severity,
        description: description || undefined,
        actual_result: actualResult || undefined,
        expected_result: expectedResult || undefined,
        environment: environment || undefined,
      }),
    onSuccess: resetAndClose,
  })

  const linkMutation = useMutation({
    mutationFn: () =>
      addDefectLink(existingDefectId, {
        linkable_type: 'execution_step',
        linkable_id: context.executionStepId,
      }),
    onSuccess: resetAndClose,
  })

  function resetAndClose() {
    setDescription('')
    setActualResult('')
    setEnvironment('')
    setSeverity('Medium')
    onClose()
  }

  const mutation = mode === 'new' ? createMutation : linkMutation
  const serverError = mutation.error instanceof ApiError ? mutation.error.message : null

  return (
      <div className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-2 gap-y-1 rounded-md bg-[var(--muted)] p-3 text-xs">
          <dt className="text-[var(--muted-foreground)]">Project</dt>
          <dd className="font-medium">{context.projectName}</dd>
          <dt className="text-[var(--muted-foreground)]">Run</dt>
          <dd className="font-medium">{context.runName}</dd>
          <dt className="text-[var(--muted-foreground)]">Test Case</dt>
          <dd className="font-medium">{context.testCaseTitle}</dd>
          <dt className="text-[var(--muted-foreground)]">Failed Step</dt>
          <dd className="font-medium">
            {context.stepNumber}. {context.action}
          </dd>
        </dl>

        <div className="flex gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`border-b-2 px-3 py-1.5 text-xs ${mode === 'new' ? 'border-[var(--primary)] font-medium' : 'border-transparent text-[var(--muted-foreground)]'}`}
          >
            Create New
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`border-b-2 px-3 py-1.5 text-xs ${mode === 'existing' ? 'border-[var(--primary)] font-medium' : 'border-transparent text-[var(--muted-foreground)]'}`}
          >
            Link Existing Defect
          </button>
        </div>

        {mode === 'new' ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="defect-title">Title (auto-suggested, editable)</Label>
              <Input id="defect-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="defect-severity">Severity</Label>
              <Select id="defect-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {(severitiesQuery.data ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="defect-actual">Actual Result</Label>
                <Textarea
                  id="defect-actual"
                  rows={2}
                  value={actualResult}
                  onChange={(e) => setActualResult(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="defect-expected">Expected Result</Label>
                <Textarea
                  id="defect-expected"
                  rows={2}
                  value={expectedResult}
                  onChange={(e) => setExpectedResult(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="defect-environment">Environment</Label>
              <Input
                id="defect-environment"
                placeholder="e.g. Staging, Chrome 130, Windows 11"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="existing-defect">Existing Defect</Label>
            <Select
              id="existing-defect"
              value={existingDefectId}
              onChange={(e) => setExistingDefectId(e.target.value)}
            >
              <option value="">Select a defect…</option>
              {(existingDefectsQuery.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.status})
                </option>
              ))}
            </Select>
          </div>
        )}

        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Skip
          </Button>
          <Button
            size="sm"
            disabled={mutation.isPending || (mode === 'existing' && !existingDefectId)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Saving…'
              : mode === 'new'
                ? 'Report Defect'
                : 'Link to This Defect'}
          </Button>
        </div>
      </div>
  )
}

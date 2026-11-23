import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createDefect, getDefectDraft, linkDefectToRunCase, type DefectDraft } from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listEnvironments } from '@/api/testAssets'
import { PickOrType } from '@/components/PickOrType'
import { StepBuilder } from '@/components/StepBuilder'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  mapServerFields,
  mapStepServerErrors,
  toCreateRequest,
  validateForm,
  valuesFromDraft,
  type DefectFormValues,
  type FormErrors,
  type FormFieldKey,
} from '@/lib/defectForm'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { DefectPicker } from '@/routes/defects/pickers'

export interface FailedStepContext {
  runCaseId: string
  executionStepId: string
  projectId: string
  projectName: string
  runName: string
  testCaseTitle: string
  stepNumber: number
  action: string
  expected: string
}

/**
 * Marking a step Fail offers to report a defect: the form is prefilled from
 * `GET /test-run-cases/{id}/defect-draft` (title, module, repro steps with the failing step flagged,
 * expected and actual result, environment, tester) and the mandatory fields stay editable here. The
 * defect is created with `test_run_case_id`, so the server links it to the test case and the run case
 * and copies the evidence. "Link Existing Defect" attaches one that already exists instead.
 */
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
    <Dialog open={open} onClose={onClose} title="Report Defect" className="max-w-2xl">
      {context && <DraftLoader key={`${context.runCaseId}-${context.executionStepId}`} context={context} onClose={onClose} />}
    </Dialog>
  )
}

function DraftLoader({ context, onClose }: { context: FailedStepContext; onClose: () => void }) {
  const draftQuery = useQuery({
    queryKey: ['defects', 'draft', context.runCaseId, context.executionStepId],
    queryFn: () => getDefectDraft(context.runCaseId),
    // A failure just recorded must be reflected, so never reuse an older draft of this run case.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  if (draftQuery.isLoading) return <p className="py-6 text-sm text-[var(--muted-foreground)]">Preparing the defect from this failed step…</p>
  if (draftQuery.isError || !draftQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorState message="Could not prepare the defect from this failed step." error={draftQuery.error} onRetry={() => draftQuery.refetch()} />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Skip
          </Button>
        </DialogFooter>
      </div>
    )
  }
  return <QuickForm draft={draftQuery.data} context={context} onClose={onClose} />
}

function QuickForm({ draft, context, onClose }: { draft: DefectDraft; context: FailedStepContext; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const prioritiesQuery = useQuery({ queryKey: ['field-options', 'defect_priority'], queryFn: () => listFieldOptions('defect_priority') })
  const severitiesQuery = useQuery({ queryKey: ['field-options', 'defect_severity'], queryFn: () => listFieldOptions('defect_severity') })
  const environmentsQuery = useQuery({ queryKey: ['environments'], queryFn: listEnvironments })

  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [values, setValues] = useState<DefectFormValues>(() => valuesFromDraft(draft, { priority: 'Medium' }))
  const [touched, setTouched] = useState<Partial<Record<FormFieldKey, true>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<FormErrors>({})
  const [stepServerErrors, setStepServerErrors] = useState<ReturnType<typeof mapStepServerErrors>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [existing, setExisting] = useState<{ id: string; primary: string; secondary: string } | null>(null)
  const [existingError, setExistingError] = useState<string | null>(null)

  const all = validateForm(values)
  const errors: FormErrors = useMemo(() => {
    const out: FormErrors = {}
    for (const key of Object.keys(all) as FormFieldKey[]) {
      const message = serverErrors[key] ?? (submitted || touched[key] ? all[key] : undefined)
      if (message) out[key] = message
    }
    for (const key of Object.keys(serverErrors) as FormFieldKey[]) if (!out[key] && serverErrors[key]) out[key] = serverErrors[key]
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, touched, submitted, serverErrors])

  function set<K extends keyof DefectFormValues>(key: K, value: DefectFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    if (serverErrors[key]) setServerErrors((s) => ({ ...s, [key]: undefined }))
  }
  function blur(key: FormFieldKey) {
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  }

  const createMutation = useMutation({
    mutationFn: () => createDefect(toCreateRequest(values, { test_run_case_id: draft.test_run_case_id })),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['defects'] })
      void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
      // Deliberately distinct from the "Defect reported" badge shown on the failed step.
      showToast('success', `New defect ${created.display_id ?? ''} created and linked to ${draft.test_case_display_id ?? 'the test case'}`.replace('  ', ' '))
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        const mapped = mapServerFields(err.fields)
        setServerErrors(mapped.errors)
        setStepServerErrors(mapStepServerErrors(err.fields))
        setFormError(mapped.other.length > 0 ? mapped.other.join('; ') : err.message)
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not report the defect. Your entries are still here; try again.')
      }
    },
  })

  const linkMutation = useMutation({
    mutationFn: (defectId: string) => linkDefectToRunCase(draft.test_run_case_id, defectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['defects'] })
      showToast('success', 'Linked to existing defect')
      onClose()
    },
    onError: (err) => setExistingError(err instanceof ApiError ? err.message : 'Could not link that defect. Try again.'),
  })

  function submitNew() {
    setFormError(null)
    setServerErrors({})
    setStepServerErrors({})
    setSubmitted(true)
    const found = validateForm(values)
    const count = Object.keys(found).length
    if (count > 0) {
      setFormError(`Fix ${count} field${count === 1 ? '' : 's'} marked below, then report the defect.`)
      return
    }
    createMutation.mutate()
  }

  const failedStep = draft.failing_step_no ?? context.stepNumber
  const stepCount = values.steps.filter((s) => s.action.trim()).length
  const stepsBad = !!errors.steps || Object.keys(stepServerErrors).length > 0

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-[var(--muted)] p-3 text-xs">
        <dt className="text-[var(--muted-foreground)]">Project</dt>
        <dd className="font-medium">{context.projectName}</dd>
        <dt className="text-[var(--muted-foreground)]">Run</dt>
        <dd className="font-medium">{draft.test_run_name}</dd>
        <dt className="text-[var(--muted-foreground)]">Test Case</dt>
        <dd className="font-medium">
          <span className="font-mono">{draft.test_case_display_id ?? ''}</span> {draft.test_case_title}
        </dd>
        <dt className="text-[var(--muted-foreground)]">Failed Step</dt>
        <dd className="font-medium">
          {failedStep}. {context.action}
        </dd>
        <dt className="text-[var(--muted-foreground)]">Tester</dt>
        <dd className="font-medium">{draft.tester_name ?? 'Unknown'}</dd>
      </dl>

      {draft.existing_defects.length > 0 && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">
          Already linked to this case in this run:{' '}
          {draft.existing_defects.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/defects/${d.id}`} className="font-mono underline underline-offset-2">
                {d.display_id ?? d.title}
              </Link>{' '}
              <DefectStatusBadge status={d.status} />
            </span>
          ))}
        </p>
      )}

      <div role="tablist" aria-label="Report or link" className="flex gap-1 border-b border-[var(--border)]">
        {(
          [
            ['new', 'Create New'],
            ['existing', 'Link Existing Defect'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={cn(
              'inline-flex h-9 items-center border-b-2 px-3 text-xs max-md:h-11',
              mode === key ? 'border-[var(--primary)] font-medium' : 'border-transparent text-[var(--muted-foreground)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'new' ? (
        <>
          <FormField id="defect-title" label="Title" required error={errors.title}>
            {(f) => <Input {...f} maxLength={255} value={values.title} onChange={(e) => set('title', e.target.value)} onBlur={() => blur('title')} />}
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="defect-severity" label="Severity" required error={errors.severity}>
              {(f) => (
                <Select
                  {...f}
                  value={values.severity}
                  onChange={(e) => {
                    set('severity', e.target.value)
                    blur('severity')
                  }}
                >
                  <option value="">Select severity…</option>
                  {(severitiesQuery.data ?? []).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="defect-priority" label="Priority" required error={errors.priority}>
              {(f) => (
                <Select {...f} value={values.priority} onChange={(e) => set('priority', e.target.value)}>
                  <option value="">Select priority…</option>
                  {(prioritiesQuery.data ?? []).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <FormField id="defect-description" label="Description" required error={errors.description} helper="What went wrong? You can add detail on the defect page.">
            {(f) => (
              <Textarea {...f} rows={2} value={values.description} onChange={(e) => set('description', e.target.value)} onBlur={() => blur('description')} />
            )}
          </FormField>
          <details open={stepsBad} className="rounded-md border border-[var(--border)]">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium max-md:min-h-11 max-md:leading-8">
              Steps to reproduce ({stepCount}, failed at step {failedStep})
              {stepsBad && <span className="ml-2 text-xs text-[var(--destructive)]">needs attention</span>}
            </summary>
            <div className="p-3">
              <StepBuilder
                steps={values.steps}
                onChange={(steps) => {
                  setValues((v) => ({ ...v, steps }))
                  if (Object.keys(stepServerErrors).length) setStepServerErrors({})
                }}
                fields="defect"
                label="Steps to Reproduce"
                idPrefix="qd-step"
                showErrors={submitted}
                serverErrors={stepServerErrors}
              />
              {errors.steps && !values.steps.some((s) => s.action.trim()) && (
                <p role="alert" className="mt-1 text-xs text-[var(--destructive)]">
                  {errors.steps}
                </p>
              )}
            </div>
          </details>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="defect-expected" label="Expected Result" required error={errors.expected_result}>
              {(f) => (
                <Textarea
                  {...f}
                  rows={2}
                  value={values.expected_result}
                  onChange={(e) => set('expected_result', e.target.value)}
                  onBlur={() => blur('expected_result')}
                />
              )}
            </FormField>
            <FormField id="defect-actual" label="Actual Result" required error={errors.actual_result}>
              {(f) => (
                <Textarea
                  {...f}
                  rows={2}
                  value={values.actual_result}
                  onChange={(e) => set('actual_result', e.target.value)}
                  onBlur={() => blur('actual_result')}
                />
              )}
            </FormField>
          </div>
          <FormField id="defect-environment" label="Environment" required error={errors.environment}>
            {(f) => (
              <PickOrType
                field={f}
                value={values.environment}
                onChange={(v) => set('environment', v)}
                onBlur={() => blur('environment')}
                choices={(environmentsQuery.data ?? []).map((e) => e.name)}
                typedLabel="Environment (typed)"
                placeholder="e.g. Staging, Chrome 130, Windows 11"
              />
            )}
          </FormField>
          <p className="text-xs text-[var(--muted-foreground)]">
            It is linked to {draft.test_case_display_id ?? 'the test case'} and to this run case automatically
            {draft.evidence.length > 0 &&
              `, and ${draft.evidence.length} attachment${draft.evidence.length === 1 ? '' : 's'} from the failed step ${draft.evidence.length === 1 ? 'is' : 'are'} copied as evidence`}
            .
          </p>
          <FormError>{formError}</FormError>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <DefectPicker
            id="existing-defect"
            projectId={draft.project_id}
            excludeIds={[...draft.existing_defects.map((d) => d.id), ...(existing ? [existing.id] : [])]}
            label="Existing Defect"
            onPick={(item) => {
              setExisting({ id: item.id, primary: item.primary, secondary: item.secondary })
              setExistingError(null)
            }}
          />
          {existing && (
            <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" aria-live="polite">
              Selected: <span className="font-mono text-xs">{existing.primary}</span> {existing.secondary}
            </p>
          )}
          <FormError>{existingError}</FormError>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Skip
        </Button>
        {mode === 'new' ? (
          <Button size="sm" loading={createMutation.isPending} onClick={submitNew}>
            Report Defect
          </Button>
        ) : (
          <Button size="sm" loading={linkMutation.isPending} disabled={!existing} onClick={() => existing && linkMutation.mutate(existing.id)}>
            Link to This Defect
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { ApiError } from '@/api/client'
import { listFieldOptions } from '@/api/fieldCustomization'
import { createTestCase } from '@/api/testCases'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  MAX_QUICK_STEPS,
  addStepRow,
  carryOver,
  cleanSteps,
  emptyDraft,
  removeStepRow,
  validateDraft,
  type QuickDraft,
  type QuickErrors,
} from '@/lib/quickCase'
import { useToast } from '@/lib/toast'

type ModuleOption = { id: string; name: string; parent_id: string | null }

/** Compact create dialog (ADR-106). Same create endpoint and rules as the full form. */
export function QuickCreateTestCaseDialog({
  open,
  onClose,
  projectId,
  modules,
  onMoreOptions,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  modules: ModuleOption[]
  /** Hand the entered values to the full form. */
  onMoreOptions: (draft: QuickDraft) => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Quick add test case" className="max-w-xl">
      <QuickForm projectId={projectId} modules={modules} onClose={onClose} onMoreOptions={onMoreOptions} />
    </Dialog>
  )
}

function QuickForm({
  projectId,
  modules,
  onClose,
  onMoreOptions,
}: {
  projectId: string
  modules: ModuleOption[]
  onClose: () => void
  onMoreOptions: (draft: QuickDraft) => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
  })
  const priorities = prioritiesQuery.data
  const [draft, setDraft] = useState<QuickDraft>(emptyDraft())
  const [errors, setErrors] = useState<QuickErrors>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const stepRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusRow = useRef<number | null>(null)
  const pendingAnother = useRef(false)

  // Priority defaults to the middle configured option, like the full form.
  useEffect(() => {
    if (!priorities || priorities.length === 0) return
    setDraft((d) =>
      priorities.some((p) => p.code === d.priority)
        ? d
        : { ...d, priority: priorities[Math.floor((priorities.length - 1) / 2)].code },
    )
  }, [priorities])

  // The overlay focuses its close button on open; take focus back to Title afterwards.
  useEffect(() => {
    const id = setTimeout(() => titleRef.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (focusRow.current !== null) {
      stepRefs.current[focusRow.current]?.focus()
      focusRow.current = null
    }
  }, [draft.steps.length])

  const mutation = useMutation({
    mutationFn: (d: QuickDraft) =>
      createTestCase(projectId, {
        title: d.title.trim(),
        priority: d.priority,
        module_id: d.module_id || null,
        steps: cleanSteps(d.steps),
      }),
    onSuccess: (_created, d) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      showToast('success', `Test case "${d.title.trim()}" created`)
      if (pendingAnother.current) {
        setDraft(carryOver(d))
        setErrors({})
        mutation.reset()
        titleRef.current?.focus()
      } else {
        onClose()
      }
    },
  })

  function submit(another: boolean) {
    const found = validateDraft(draft)
    setErrors(found)
    if (found.title) return titleRef.current?.focus()
    if (found.stepRow !== undefined) return stepRefs.current[found.stepRow * 2]?.focus()
    pendingAnother.current = another
    mutation.mutate(draft)
  }

  function setStep(i: number, key: 'action' | 'expected', value: string) {
    setErrors((x) => ({ ...x, steps: undefined, stepRow: undefined }))
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, [key]: value } : s)) }))
  }

  function onStepKey(e: KeyboardEvent<HTMLInputElement>, i: number, key: 'action' | 'expected') {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    if (key === 'action') return stepRefs.current[i * 2 + 1]?.focus()
    // Enter in the last row's expected field starts the next row.
    if (i === draft.steps.length - 1 && draft.steps.length < MAX_QUICK_STEPS) {
      focusRow.current = (i + 1) * 2
      setDraft((d) => ({ ...d, steps: addStepRow(d.steps) }))
    }
  }

  const serverError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Could not create the test case'
        : null
  const dirty = !!draft.title || draft.steps.some((s) => s.action || s.expected)

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          submit(false)
        }
      }}
    >
      <ReportDirty dirty={dirty} />
      <FormField id="qc-title" label="Title" required error={errors.title}>
        {(field) => (
          <Input
            {...field}
            ref={titleRef}
            value={draft.title}
            onChange={(e) => {
              setDraft({ ...draft, title: e.target.value })
              setErrors((x) => ({ ...x, title: undefined }))
            }}
            onBlur={() =>
              setErrors((x) => ({
                ...x,
                title: draft.title && draft.title.trim().length < 5 ? 'At least 5 characters' : undefined,
              }))
            }
          />
        )}
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="qc-priority" label="Priority" required error={errors.priority}>
          {(field) => (
            <Select
              {...field}
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            >
              {(priorities ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="qc-module" label="Module">
          {(field) => (
            <Select
              {...field}
              value={draft.module_id}
              onChange={(e) => setDraft({ ...draft, module_id: e.target.value })}
            >
              <option value="">No module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.parent_id ? `↳ ${m.name}` : m.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Steps
          <span aria-hidden="true" className="ml-0.5 text-[var(--destructive)]">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </legend>
        {draft.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-[var(--border)] p-2">
            <span className="mt-2 w-5 shrink-0 text-xs text-[var(--muted-foreground)]">{i + 1}.</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Input
                ref={(el) => {
                  stepRefs.current[i * 2] = el
                }}
                placeholder="Action"
                aria-label={`Step ${i + 1} action`}
                aria-invalid={errors.stepRow === i ? true : undefined}
                value={s.action}
                onChange={(e) => setStep(i, 'action', e.target.value)}
                onKeyDown={(e) => onStepKey(e, i, 'action')}
              />
              <Input
                ref={(el) => {
                  stepRefs.current[i * 2 + 1] = el
                }}
                placeholder="Expected outcome"
                aria-label={`Step ${i + 1} expected outcome`}
                aria-invalid={errors.stepRow === i ? true : undefined}
                value={s.expected}
                onChange={(e) => setStep(i, 'expected', e.target.value)}
                onKeyDown={(e) => onStepKey(e, i, 'expected')}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={draft.steps.length === 1}
              aria-label={`Remove step ${i + 1}`}
              onClick={() => setDraft((d) => ({ ...d, steps: removeStepRow(d.steps, i) }))}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {errors.steps && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {errors.steps}
          </p>
        )}
        {draft.steps.length < MAX_QUICK_STEPS && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((d) => ({ ...d, steps: addStepRow(d.steps) }))}
            >
              <Plus className="size-4" aria-hidden="true" /> Add step
            </Button>
          </div>
        )}
      </fieldset>

      <FormError>{serverError}</FormError>

      <div className="flex flex-wrap items-center gap-2 max-md:flex-col-reverse max-md:items-stretch">
        <button
          type="button"
          onClick={() => onMoreOptions(draft)}
          className="mr-auto text-sm underline underline-offset-2 hover:text-[var(--foreground)] max-md:mr-0 max-md:min-h-11 max-md:text-center"
        >
          More options
        </button>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => submit(true)}>
          Create and add another
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Create
        </Button>
      </div>
      <p className="text-xs text-[var(--muted-foreground)] max-md:hidden">Ctrl/Cmd + Enter to create</p>
    </form>
  )
}

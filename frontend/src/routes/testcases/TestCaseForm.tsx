import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Copy, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { z } from 'zod'

import { listFieldOptions } from '@/api/fieldCustomization'
import type { SharedStep } from '@/api/sharedSteps'
import type { TestCaseCreateRequest } from '@/api/testCases'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Tier 5 / ADR-055: priority is a tenant-configurable value set, not a
// fixed enum any more -- the dropdown's options come from the tenant's own
// `field_options` instead of a hardcoded list.
// Pass 2 (ADR-061): Module and Description are marked required in this
// form's labels/placeholders (per the confirmed spreadsheet-aligned
// schema), but NOT hard-blocked by Zod validation -- a project with zero
// modules yet would otherwise lock a user out of creating their first
// test case at all (no module to select, no way to create one from a
// dropdown with no escape hatch). Matches the same deliberate, disclosed
// backward-compatible trade-off already made at the API layer (see
// TestCaseCreateRequest's own note).
const schema = z.object({
  title: z.string().min(5, 'At least 5 characters'),
  module_id: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().min(1, 'Required'),
  assignee_id: z.string().optional(),
  scenario_id: z.string().optional(),
  scenario_description: z.string().optional(),
  prerequisite: z.string().optional(),
  test_data: z.string().optional(),
  steps: z
    .array(
      z.object({
        action: z.string().min(1, 'Required'),
        expected: z.string().min(1, 'Required'),
      }),
    )
    .min(1, 'At least one step is required'),
})

export type TestCaseFormValues = z.infer<typeof schema>

export function TestCaseForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
  serverError,
  users = [],
  modules = [],
  sharedSteps = [],
}: {
  defaultValues: TestCaseFormValues
  onSubmit: (values: TestCaseCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
  users?: { id: string; name: string }[]
  modules?: { id: string; name: string; parent_id: string | null }[]
  sharedSteps?: SharedStep[]
}) {
  const [libraryPick, setLibraryPick] = useState('')
  const form = useForm<TestCaseFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur',
  })

  // Bug #11: no unsaved-changes warning previously existed -- a user could
  // lose a half-filled form by navigating away or closing the tab with no
  // prompt at all.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (form.formState.isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [form.formState.isDirty])
  // Closing the surrounding drawer with unsaved edits asks first.
  useReportDirty(form.formState.isDirty)
  const errors = form.formState.errors
  const { fields, append, remove, insert, move } = useFieldArray({
    control: form.control,
    name: 'steps',
  })
  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
  })

  // Bug #11's "Priority defaults to Low" report: the caller's hardcoded
  // 'Medium' default silently didn't match the select's rendered options
  // whenever a tenant's configured priority codes didn't include that
  // exact string -- the browser then just visually shows its first
  // <option> (often the lowest-severity one by convention) while the form
  // state stayed on the now-orphaned value. Once real options load, snap
  // to the middle one if the current value isn't actually selectable.
  const priorityOptions = prioritiesQuery.data ?? []
  useEffect(() => {
    if (priorityOptions.length === 0) return
    const current = form.getValues('priority')
    if (priorityOptions.some((p) => p.code === current)) return
    const middle = priorityOptions[Math.floor((priorityOptions.length - 1) / 2)]
    form.setValue('priority', middle.code, { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityOptions])

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) =>
        onSubmit({
          ...values,
          // Pass 2: an empty-string value from an unselected select is
          // not a valid UUID -- the API schema requires a real UUID or
          // nothing at all. Found via a real E2E failure: the create
          // request was silently rejected (422) whenever no module was
          // picked, which the form's own serverError display never
          // surfaced clearly enough to be caught by eye during this pass.
          module_id: values.module_id || null,
          assignee_id: values.assignee_id || null,
        }),
      )}
    >
      <FormField id="title" label="Title" required error={errors.title?.message}>
        {(field) => <Input {...field} {...form.register('title')} />}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="module_id" label="Module" error={errors.module_id?.message}>
          {(field) => (
            <Select {...field} {...form.register('module_id')}>
              <option value="">Select a module…</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.parent_id ? `↳ ${m.name}` : m.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="scenario_id" label="Scenario ID">
          {(field) => <Input {...field} {...form.register('scenario_id')} />}
        </FormField>
      </div>

      <FormField id="scenario_description" label="Scenario Description">
        {(field) => <Textarea {...field} {...form.register('scenario_description')} />}
      </FormField>

      <FormField id="description" label="Description" error={errors.description?.message}>
        {(field) => <Textarea {...field} {...form.register('description')} />}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="prerequisite" label="Prerequisite">
          {(field) => <Textarea {...field} {...form.register('prerequisite')} />}
        </FormField>
        <FormField id="test_data" label="Test Data">
          {(field) => <Textarea {...field} {...form.register('test_data')} />}
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="priority" label="Priority" required error={errors.priority?.message}>
          {(field) => (
            <Select {...field} {...form.register('priority')}>
              {(prioritiesQuery.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="assignee_id" label="Assignee">
          {(field) => (
            <Select {...field} {...form.register('assignee_id')}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <div className="flex flex-col gap-2">
        <Label required>Steps</Label>
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="flex items-start gap-2 rounded-md border border-[var(--border)] p-2 max-md:flex-wrap"
          >
            <span className="mt-2 w-5 shrink-0 text-xs text-[var(--muted-foreground)]">{index + 1}.</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 max-md:basis-[calc(100%-1.75rem)]">
              <Input
                placeholder="Action"
                aria-label={`Step ${index + 1} action`}
                aria-invalid={errors.steps?.[index]?.action ? true : undefined}
                {...form.register(`steps.${index}.action` as const)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    insert(index + 1, { action: '', expected: '' })
                  }
                }}
              />
              <Input
                placeholder="Expected outcome"
                aria-label={`Step ${index + 1} expected outcome`}
                aria-invalid={errors.steps?.[index]?.expected ? true : undefined}
                {...form.register(`steps.${index}.expected` as const)}
              />
              {(errors.steps?.[index]?.action || errors.steps?.[index]?.expected) && (
                <p role="alert" className="text-xs text-[var(--destructive)]">
                  Step {index + 1}: enter both an action and an expected outcome.
                </p>
              )}
            </div>
            <div className="flex items-start gap-0.5 max-md:w-full max-md:justify-end">
            <div className="flex flex-col gap-0.5 max-md:flex-row">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={`Move step ${index + 1} up`}
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => move(index, index + 1)}
                disabled={index === fields.length - 1}
                aria-label={`Move step ${index + 1} down`}
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const step = form.getValues(`steps.${index}`)
                insert(index + 1, { ...step })
              }}
              aria-label={`Duplicate step ${index + 1}`}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
              disabled={fields.length === 1}
              aria-label={`Remove step ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
            </div>
          </div>
        ))}
        <FormError>{errors.steps?.message}</FormError>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ action: '', expected: '' })}>
            Add Step
          </Button>
          {sharedSteps.length > 0 && (
            <>
              <Select
                aria-label="Insert from shared step library"
                className="max-w-[16rem] max-md:max-w-none max-md:flex-1"
                value={libraryPick}
                onChange={(e) => setLibraryPick(e.target.value)}
              >
                <option value="">Insert from library…</option>
                {sharedSteps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!libraryPick}
                onClick={() => {
                  const picked = sharedSteps.find((s) => s.id === libraryPick)
                  if (!picked) return
                  // Copy, not a live link -- see SharedStepsDialog's note.
                  append({ action: picked.action, expected: picked.expected })
                  setLibraryPick('')
                }}
              >
                Insert
              </Button>
            </>
          )}
        </div>
      </div>

      <FormError>{serverError}</FormError>

      {/* Phone: the submit sits pinned at the bottom of the Drawer so a long
          form never leaves it off-screen. */}
      <div className="max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:mt-1 max-md:border-t max-md:border-[var(--border)] max-md:bg-[var(--tactile-surface-raised)] max-md:px-4 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pt-3">
        <Button type="submit" disabled={isSubmitting} className="mt-2 max-md:mt-0 max-md:w-full">
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

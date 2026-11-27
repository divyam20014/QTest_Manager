import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useState } from 'react'

import type { ProjectCreateRequest } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { useReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const STATUSES = ['On Track', 'At Risk', 'Delayed', 'Completed'] as const

// ADR-139: only the name is required. Empty text stands for "not set".
const schema = z
  .object({
    name: z.string().min(3, 'At least 3 characters'),
    domain: z.string(),
    priority: z.enum(PRIORITIES),
    status: z.enum(STATUSES),
    manager_name: z.string(),
    manager_user_id: z.string().optional(),
    template_project_id: z.string().optional(),
    start_date: z.string(),
    end_date: z.string(),
    budget: z
      .string()
      .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), 'Must be zero or more'),
    region: z.string(),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    message: 'End date cannot be before start date',
    path: ['end_date'],
  })

/** What the API receives: blank details as null, so saving also clears them. */
export function toProjectRequest(values: ProjectFormValues): ProjectCreateRequest {
  const orNull = (v: string | undefined) => v?.trim() || null
  return {
    ...values,
    template_project_id: values.template_project_id || undefined,
    domain: orNull(values.domain),
    manager_name: orNull(values.manager_name),
    manager_user_id: values.manager_user_id || null,
    start_date: orNull(values.start_date),
    end_date: orNull(values.end_date),
    budget: orNull(values.budget),
    region: orNull(values.region),
  }
}

export type ProjectFormValues = z.infer<typeof schema>

export function ProjectForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
  serverError,
  users = [],
  domains = [],
  templates = [],
  inDialog = false,
}: {
  defaultValues: ProjectFormValues
  onSubmit: (values: ProjectCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
  users?: { id: string; name: string }[]
  /** The organization's project domains. */
  domains?: string[]
  /** Projects a new one can copy its setup from; pass none when editing. */
  templates?: { id: string; name: string }[]
  /** Rendered inside a Dialog: pin the submit button in the sheet footer on phones. */
  inDialog?: boolean
}) {
  const form = useForm<ProjectFormValues>({ resolver: zodResolver(schema), defaultValues })
  const errors = form.formState.errors
  // A new project opens short; an existing one shows everything it can edit.
  const [moreOpen, setMoreOpen] = useState(!inDialog)
  // The project's own domain stays selectable even if it has left the organization's list.
  const domainChoices = [...new Set([...domains, ...(defaultValues.domain ? [defaultValues.domain] : [])])]
  // Closing the surrounding dialog with unsaved edits asks first.
  useReportDirty(form.formState.isDirty)

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={form.handleSubmit(
        (values) => onSubmit(toProjectRequest(values)),
        // A problem inside the folded part must not stay hidden.
        () => setMoreOpen(true),
      )}
    >
      <FormField id="name" label="Name" required error={errors.name?.message}>
        {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
      </FormField>

      {templates.length > 0 && (
        <FormField
          id="template_project_id"
          label="Copy setup from (optional)"
          helper="Copies that project's visible tabs and module folders. No test cases, people or other work are copied."
        >
          {(field) => (
            <Select {...field} {...form.register('template_project_id')}>
              <option value="">Start with the defaults</option>
              {templates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="domain" label="Domain" error={errors.domain?.message}>
          {(field) => (
            <Select {...field} {...form.register('domain')}>
              <option value="">Not set</option>
              {domainChoices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="priority" label="Priority" error={errors.priority?.message}>
          {(field) => (
            <Select {...field} {...form.register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <details
        open={moreOpen}
        onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        className="rounded-md border border-[var(--border)] px-3"
      >
        <summary className="cursor-pointer py-2 text-sm font-medium max-md:py-3">More details (optional)</summary>
        <div className="flex flex-col gap-3 pb-3">
      <FormField id="status" label="Status" error={errors.status?.message}>
        {(field) => (
          <Select {...field} {...form.register('status')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="manager_name" label="Manager name" error={errors.manager_name?.message}>
        {(field) => <Input {...field} autoComplete="off" {...form.register('manager_name')} />}
      </FormField>

      {users.length > 0 && (
        <FormField
          id="manager_user_id"
          label="Linked manager account (optional)"
          helper="Link a user account so this manager can sign in and see the project."
        >
          {(field) => (
            <Select {...field} {...form.register('manager_user_id')}>
              <option value="">Not linked to a user account</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="start_date" label="Start date" error={errors.start_date?.message}>
          {(field) => <Input {...field} type="date" {...form.register('start_date')} />}
        </FormField>
        <FormField id="end_date" label="End date" error={errors.end_date?.message}>
          {(field) => <Input {...field} type="date" {...form.register('end_date')} />}
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="budget" label="Budget" error={errors.budget?.message}>
          {(field) => (
            <Input {...field} type="number" inputMode="decimal" min={0} step="0.01" {...form.register('budget')} />
          )}
        </FormField>
        <FormField id="region" label="Region" error={errors.region?.message}>
          {(field) => <Input {...field} {...form.register('region')} />}
        </FormField>
      </div>
        </div>
      </details>

      <FormError>{serverError}</FormError>

      {inDialog ? (
        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      ) : (
        <Button type="submit" disabled={isSubmitting} className="mt-2">
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      )}
    </form>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { ProjectCreateRequest } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { useReportDirty } from '@/components/ui/dirtyForm'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const DOMAINS = ['Motor', 'Health', 'Travel', 'Life', 'Property'] as const
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const STATUSES = ['On Track', 'At Risk', 'Delayed', 'Completed'] as const

const schema = z
  .object({
    name: z.string().min(3, 'At least 3 characters'),
    domain: z.enum(DOMAINS),
    priority: z.enum(PRIORITIES),
    status: z.enum(STATUSES),
    manager_name: z.string().min(1, 'Required'),
    manager_user_id: z.string().optional(),
    start_date: z.string().min(1, 'Required'),
    end_date: z.string().min(1, 'Required'),
    budget: z
      .string()
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, 'Must be zero or more'),
    region: z.string().min(1, 'Required'),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: 'End date cannot be before start date',
    path: ['end_date'],
  })

export type ProjectFormValues = z.infer<typeof schema>

export function ProjectForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
  serverError,
  users = [],
  inDialog = false,
}: {
  defaultValues: ProjectFormValues
  onSubmit: (values: ProjectCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
  users?: { id: string; name: string }[]
  /** Rendered inside a Dialog: pin the submit button in the sheet footer on phones. */
  inDialog?: boolean
}) {
  const form = useForm<ProjectFormValues>({ resolver: zodResolver(schema), defaultValues })
  const errors = form.formState.errors
  // Closing the surrounding dialog with unsaved edits asks first.
  useReportDirty(form.formState.isDirty)

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        onSubmit({ ...values, manager_user_id: values.manager_user_id || null }),
      )}
    >
      <FormField id="name" label="Name" required error={errors.name?.message}>
        {(field) => <Input {...field} autoComplete="off" {...form.register('name')} />}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="domain" label="Domain" required error={errors.domain?.message}>
          {(field) => (
            <Select {...field} {...form.register('domain')}>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField id="priority" label="Priority" required error={errors.priority?.message}>
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

      <FormField id="status" label="Status" required error={errors.status?.message}>
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

      <FormField id="manager_name" label="Manager name" required error={errors.manager_name?.message}>
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
        <FormField id="start_date" label="Start date" required error={errors.start_date?.message}>
          {(field) => <Input {...field} type="date" {...form.register('start_date')} />}
        </FormField>
        <FormField id="end_date" label="End date" required error={errors.end_date?.message}>
          {(field) => <Input {...field} type="date" {...form.register('end_date')} />}
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="budget" label="Budget" required error={errors.budget?.message}>
          {(field) => (
            <Input {...field} type="number" inputMode="decimal" min={0} step="0.01" {...form.register('budget')} />
          )}
        </FormField>
        <FormField id="region" label="Region" required error={errors.region?.message}>
          {(field) => <Input {...field} {...form.register('region')} />}
        </FormField>
      </div>

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

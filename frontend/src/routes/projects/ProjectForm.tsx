import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { ProjectCreateRequest } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
}: {
  defaultValues: ProjectFormValues
  onSubmit: (values: ProjectCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
}) {
  const form = useForm<ProjectFormValues>({ resolver: zodResolver(schema), defaultValues })

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) => onSubmit(values))}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...form.register('name')} />
        {form.formState.errors.name && (
          <p className="text-xs text-[var(--destructive)]">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="domain">Domain</Label>
          <Select id="domain" {...form.register('domain')}>
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" {...form.register('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <Select id="status" {...form.register('status')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manager_name">Manager name</Label>
        <Input id="manager_name" {...form.register('manager_name')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" type="date" {...form.register('start_date')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="end_date">End date</Label>
          <Input id="end_date" type="date" {...form.register('end_date')} />
          {form.formState.errors.end_date && (
            <p className="text-xs text-[var(--destructive)]">{form.formState.errors.end_date.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budget">Budget</Label>
          <Input id="budget" type="number" min={0} step="0.01" {...form.register('budget')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="region">Region</Label>
          <Input id="region" {...form.register('region')} />
        </div>
      </div>

      {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}

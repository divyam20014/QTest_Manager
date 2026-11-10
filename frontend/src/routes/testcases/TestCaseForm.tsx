import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Copy, Trash2 } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { z } from 'zod'

import { listFieldOptions } from '@/api/fieldCustomization'
import type { TestCaseCreateRequest } from '@/api/testCases'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Tier 5 / ADR-055: priority is a tenant-configurable value set, not a
// fixed enum any more -- the dropdown's options come from the tenant's own
// `field_options` instead of a hardcoded list.
const schema = z.object({
  title: z.string().min(5, 'At least 5 characters'),
  description: z.string().optional(),
  priority: z.string().min(1, 'Required'),
  assignee_id: z.string().optional(),
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
}: {
  defaultValues: TestCaseFormValues
  onSubmit: (values: TestCaseCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
  users?: { id: string; name: string }[]
}) {
  const form = useForm<TestCaseFormValues>({ resolver: zodResolver(schema), defaultValues })
  const { fields, append, remove, insert, move } = useFieldArray({
    control: form.control,
    name: 'steps',
  })
  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
  })

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) =>
        onSubmit({ ...values, assignee_id: values.assignee_id || null }),
      )}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-xs text-[var(--destructive)]">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" {...form.register('description')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" {...form.register('priority')}>
            {(prioritiesQuery.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignee_id">Assignee</Label>
          <Select id="assignee_id" {...form.register('assignee_id')}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Steps</Label>
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="flex items-start gap-2 rounded-md border border-[var(--border)] p-2"
          >
            <span className="mt-2 w-5 shrink-0 text-xs text-[var(--muted-foreground)]">{index + 1}.</span>
            <div className="flex flex-1 flex-col gap-1.5">
              <Input
                placeholder="Action"
                {...form.register(`steps.${index}.action` as const)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    insert(index + 1, { action: '', expected: '' })
                  }
                }}
              />
              <Input placeholder="Expected outcome" {...form.register(`steps.${index}.expected` as const)} />
            </div>
            <div className="flex flex-col gap-0.5">
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
        ))}
        {form.formState.errors.steps?.message && (
          <p className="text-xs text-[var(--destructive)]">{form.formState.errors.steps.message}</p>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => append({ action: '', expected: '' })}>
          Add Step
        </Button>
      </div>

      {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}

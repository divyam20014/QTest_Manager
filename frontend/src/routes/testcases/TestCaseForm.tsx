import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2 } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { z } from 'zod'

import type { TestCaseCreateRequest } from '@/api/testCases'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const

const schema = z.object({
  title: z.string().min(5, 'At least 5 characters'),
  priority: z.enum(PRIORITIES),
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
}: {
  defaultValues: TestCaseFormValues
  onSubmit: (values: TestCaseCreateRequest) => void
  submitLabel: string
  isSubmitting: boolean
  serverError?: string | null
}) {
  const form = useForm<TestCaseFormValues>({ resolver: zodResolver(schema), defaultValues })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'steps' })

  return (
    <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((values) => onSubmit(values))}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...form.register('title')} />
        {form.formState.errors.title && (
          <p className="text-xs text-[var(--destructive)]">{form.formState.errors.title.message}</p>
        )}
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

      <div className="flex flex-col gap-2">
        <Label>Steps</Label>
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-start gap-2 rounded-md border border-[var(--border)] p-2">
            <span className="mt-2 w-5 shrink-0 text-xs text-[var(--muted-foreground)]">{index + 1}.</span>
            <div className="flex flex-1 flex-col gap-1.5">
              <Input placeholder="Action" {...form.register(`steps.${index}.action` as const)} />
              <Input placeholder="Expected outcome" {...form.register(`steps.${index}.expected` as const)} />
            </div>
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

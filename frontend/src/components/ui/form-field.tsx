import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** What a control needs to be wired to its label, helper text and error. */
export interface FieldA11yProps {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/**
 * One standard form row: label (with the shared required marker), the control,
 * optional helper text, and the error message directly under the control.
 *
 * The control is rendered through a function so the field can hand it the id,
 * `aria-invalid` and `aria-describedby` that connect it to the helper and error
 * text -- screen readers then announce the problem when the field is focused:
 *
 *   <FormField id="name" label="Name" required error={errors.name?.message}>
 *     {(field) => <Input {...field} {...register('name')} />}
 *   </FormField>
 */
export function FormField({
  id,
  label,
  required,
  helper,
  error,
  className,
  children,
}: {
  id: string
  label: ReactNode
  required?: boolean
  helper?: ReactNode
  error?: string
  className?: string
  children: (field: FieldA11yProps) => ReactNode
}) {
  const helperId = helper ? `${id}-helper` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {helper && (
        <p id={helperId} className="text-xs text-[var(--muted-foreground)]">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  )
}

/** A form-level (server) error shown above the submit button; announced when it appears. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-xs text-[var(--destructive)]">
      {children}
    </p>
  )
}

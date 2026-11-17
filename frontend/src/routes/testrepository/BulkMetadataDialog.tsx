import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { listFieldOptions } from '@/api/fieldCustomization'
import type { User } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'

export type BulkMetadataKind = 'priority' | 'assignee'

// BRD FR-TC-03: bulk priority and bulk assignee on the Test Repository. Both
// are metadata-only on the server (ADR-070): an approved case stays approved
// and keeps its version -- say so up front, because "editing an approved case
// sends it back to draft" is what people expect from the single-item form.
export function BulkMetadataDialog({
  kind,
  count,
  users,
  pending,
  onClose,
  onSubmit,
}: {
  kind: BulkMetadataKind | null
  count: number
  users: User[]
  pending: boolean
  onClose: () => void
  onSubmit: (value: string | null) => void
}) {
  const title = kind === 'assignee' ? 'Change assignee' : 'Change priority'
  return (
    <Dialog open={kind !== null} onClose={pending ? () => undefined : onClose} title={title}>
      {/* Mounted only while open, so it always starts with nothing chosen. */}
      {kind && (
        <BulkMetadataForm
          kind={kind}
          count={count}
          users={users}
          pending={pending}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  )
}

function BulkMetadataForm({
  kind,
  count,
  users,
  pending,
  onClose,
  onSubmit,
}: {
  kind: BulkMetadataKind
  count: number
  users: User[]
  pending: boolean
  onClose: () => void
  onSubmit: (value: string | null) => void
}) {
  const [value, setValue] = useState('')
  const isPriority = kind === 'priority'

  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'test_case_priority'],
    queryFn: () => listFieldOptions('test_case_priority'),
    enabled: isPriority,
  })

  const canSubmit = isPriority ? value !== '' : true

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit || pending) return
        // '' means "Unassigned" for the assignee picker.
        onSubmit(isPriority ? value : value === '' ? null : value)
      }}
    >
      <p className="text-sm text-[var(--muted-foreground)]">
        Applies to {count} selected test case{count === 1 ? '' : 's'}. Approved cases stay approved and keep their
        version — only the {isPriority ? 'priority' : 'assignee'} changes.
      </p>
      {isPriority ? (
        <FormField id="bulk-priority" label="New priority" required>
          {(field) => (
            <Select {...field} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose a priority…</option>
              {(prioritiesQuery.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : (
        <FormField
          id="bulk-assignee"
          label="New assignee"
          helper="Choose Unassigned to clear the assignee. Cases in projects the person is not a member of are reported as failed."
        >
          {(field) => (
            <Select {...field} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Unassigned</option>
              {users
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          )}
        </FormField>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || pending}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
      </DialogFooter>
    </form>
  )
}

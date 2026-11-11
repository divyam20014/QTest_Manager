import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  getCustomFieldValues,
  listCustomFieldDefinitions,
  setCustomFieldValues,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
} from '@/api/fieldCustomization'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/lib/toast'

// Tier 5 / ADR-055: tenant-defined custom fields. Values are already
// included inline on the owning entity's own GET response (`custom_fields`)
// -- this card re-fetches via the dedicated values endpoint instead so it
// can also write, and reflects server-side validation per field type.
function FieldInput({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (definition.field_type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    )
  }
  if (definition.field_type === 'select') {
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {(definition.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    )
  }
  if (definition.field_type === 'multi_select') {
    const selected = Array.isArray(value) ? (value as string[]) : []
    return (
      <div className="flex flex-wrap gap-2">
        {(definition.options ?? []).map((o) => (
          <label key={o} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o] : selected.filter((v) => v !== o))
              }
            />
            {o}
          </label>
        ))}
      </div>
    )
  }
  if (definition.field_type === 'number') {
    return (
      <Input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  }
  if (definition.field_type === 'date') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    )
  }
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value || null)}
    />
  )
}

export function CustomFieldsCard({
  ownerType,
  ownerId,
}: {
  ownerType: CustomFieldEntityType
  ownerId: string
}) {
  const queryClient = useQueryClient()
  const definitionsQuery = useQuery({
    queryKey: ['custom-field-definitions', ownerType],
    queryFn: () => listCustomFieldDefinitions(ownerType),
  })
  const valuesQuery = useQuery({
    queryKey: ['custom-field-values', ownerType, ownerId],
    queryFn: () => getCustomFieldValues(ownerType, ownerId),
  })

  // Local edits layered over the server's last-known values, rather than
  // copied into state via an effect -- avoids a render-triggering setState
  // inside an effect for what's really a derived value.
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const merged = { ...valuesQuery.data?.values, ...edits }
  const { show: showToast } = useToast()

  const saveMutation = useMutation({
    mutationFn: () => setCustomFieldValues(ownerType, ownerId, merged),
    onSuccess: (data) => {
      queryClient.setQueryData(['custom-field-values', ownerType, ownerId], data)
      setEdits({})
      showToast('success', 'Custom field values saved')
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  if (!definitionsQuery.data || definitionsQuery.data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Fields</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-3 text-sm">
          {definitionsQuery.data.map((def) => (
            <div key={def.id} className="flex flex-col gap-1.5">
              <Label htmlFor={`custom-field-${def.id}`}>
                {def.label}
                {def.required && ' *'}
              </Label>
              <FieldInput
                definition={def}
                value={merged[def.field_key]}
                onChange={(value) => setEdits((prev) => ({ ...prev, [def.field_key]: value }))}
              />
            </div>
          ))}
          {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
          <Button
            type="button"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Custom Fields'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

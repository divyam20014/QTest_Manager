import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { FieldA11yProps } from '@/components/ui/form-field'

const OTHER = '__other'

/**
 * A text value that can also be picked from a short list (a release for "Fix Version", an
 * environment for "Environment"). With no choices it is just a text box. With choices a select
 * offers them plus "Other (type it)", which reveals the text box; a stored value that is not in the
 * list opens as "Other" with the text filled in, so nothing the user typed is ever lost.
 */
export function PickOrType({
  field,
  value,
  onChange,
  onBlur,
  choices,
  noneLabel = 'Not set',
  otherLabel = 'Other (type it)',
  typedLabel = 'Type a value',
  placeholder,
  maxLength = 200,
  disabled,
}: {
  field: FieldA11yProps
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  choices: string[]
  noneLabel?: string
  otherLabel?: string
  /** Accessible name of the text box shown for "Other". */
  typedLabel?: string
  placeholder?: string
  maxLength?: number
  disabled?: boolean
}) {
  if (choices.length === 0) {
    return (
      <Input
        {...field}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    )
  }
  const known = choices.includes(value)
  const picked = known ? value : value ? OTHER : ''
  return (
    <div className="flex flex-col gap-2">
      <Select
        {...field}
        value={picked}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          onChange(next === OTHER ? (known ? '' : value) || ' ' : next)
        }}
        onBlur={onBlur}
      >
        <option value="">{noneLabel}</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={OTHER}>{otherLabel}</option>
      </Select>
      {picked === OTHER && (
        <Input
          id={`${field.id}-text`}
          aria-label={typedLabel}
          aria-invalid={field['aria-invalid']}
          value={value.trim() === '' ? '' : value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )}
    </div>
  )
}

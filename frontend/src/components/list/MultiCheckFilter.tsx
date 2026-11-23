import { cn } from '@/lib/utils'

/**
 * A multi-value filter as a group of checkboxes (status, severity, priority). Selecting several
 * means "any of". `value` is the selected codes; the parent decides how they are stored (the lists
 * keep them as a comma-separated URL value). Each box is named by its option label, so the group
 * is operable by keyboard and screen reader without a popup.
 */
export function MultiCheckFilter({
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: {
  legend: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (value: string[]) => void
  columns?: 1 | 2
}) {
  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter((v) => v !== code) : [...value, code])
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs text-[var(--muted-foreground)]">
        {legend}
        {value.length > 0 && <span className="ml-1 tabular-nums">({value.length} selected)</span>}
      </legend>
      <div className={cn('grid gap-x-3 gap-y-0.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {options.map((o) => (
          <label key={o.value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-[var(--muted)] max-md:min-h-11">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            <span className="min-w-0 break-words">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

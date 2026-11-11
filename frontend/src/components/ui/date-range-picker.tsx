import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDate(d)
}

function startOfThisMonth(): string {
  const d = new Date()
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: 'Last 7 days', from: () => daysAgo(7), to: () => isoDate(new Date()) },
  { label: 'Last 30 days', from: () => daysAgo(30), to: () => isoDate(new Date()) },
  { label: 'This month', from: startOfThisMonth, to: () => isoDate(new Date()) },
]

/** A date-range filter with quick presets (bug #14: raw dd-mm-yyyy inputs
 * with no shortcuts). Built on the native <input type="date"> rather than
 * a new dependency -- the presets are what was actually missing, not the
 * picker widget itself. */
export function DateRangePicker({
  fromValue,
  toValue,
  onChange,
  idPrefix,
  className,
}: {
  fromValue: string
  toValue: string
  onChange: (from: string, to: string) => void
  idPrefix: string
  className?: string
}) {
  const activePreset = PRESETS.find((p) => p.from() === fromValue && p.to() === toValue)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.from(), p.to())}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              activePreset?.label === p.label
                ? 'border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--link)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
            )}
          >
            {p.label}
          </button>
        ))}
        {(fromValue || toValue) && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="rounded-full px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${idPrefix}-from`} className="text-xs text-[var(--muted-foreground)]">
          From
        </Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={fromValue}
          onChange={(e) => onChange(e.target.value, toValue)}
          className="w-36"
        />
        <Label htmlFor={`${idPrefix}-to`} className="text-xs text-[var(--muted-foreground)]">
          To
        </Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={toValue}
          onChange={(e) => onChange(fromValue, e.target.value)}
          className="w-36"
        />
      </div>
    </div>
  )
}

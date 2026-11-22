import { useRef } from 'react'

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
  const fromRef = useRef<HTMLInputElement>(null)
  // "Custom" is active when there is a range that matches no preset.
  const customActive = !activePreset && Boolean(fromValue || toValue)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div role="group" aria-label="Date range presets" className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={activePreset?.label === p.label}
            onClick={() => onChange(p.from(), p.to())}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-3 max-md:text-sm',
              activePreset?.label === p.label
                ? 'border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--link)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={customActive}
          onClick={() => fromRef.current?.focus()}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-3 max-md:text-sm',
            customActive
              ? 'border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--link)]'
              : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
          )}
        >
          Custom
        </button>
        {(fromValue || toValue) && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="rounded-full px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] max-md:min-h-11 max-md:px-3 max-md:text-sm"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${idPrefix}-from`} className="text-xs text-[var(--muted-foreground)]">
          From
        </Label>
        <Input
          id={`${idPrefix}-from`}
          ref={fromRef}
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

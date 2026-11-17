import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/**
 * Two-or-three way one-click switch ("All cases / Assigned to me"). A group
 * of toggle buttons (`aria-pressed`), not tabs: it filters the list in place
 * and has no panel of its own. The pressed segment uses the tactile raised
 * chip, the track the pressed well, so it reads as one physical switch.
 */
export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name for the group. */
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'qth-pressed-sm inline-flex shrink-0 gap-0.5 rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5 max-md:flex max-md:w-full',
        className,
      )}
    >
      {options.map((option) => {
        const pressed = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[5px] px-3 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] max-md:h-11 max-md:flex-1 max-md:text-base',
              pressed
                ? 'qth-raised-sm bg-[var(--tactile-surface-raised)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

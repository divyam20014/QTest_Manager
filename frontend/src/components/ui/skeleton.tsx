import { cn } from '@/lib/utils'

/** Shared shimmer block -- one skeleton primitive every loading state in
 * the app composes from, so "loading" looks the same everywhere instead
 * of a per-page "Loading…" string or a blank gap (Pass B UI/UX overhaul,
 * bug #4: Defects/Reports/Execution showed a blank table or raw text
 * before data arrived). */
export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: { height?: string; width?: string }
}) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn('animate-pulse rounded-md bg-[var(--muted)]', className)}
    />
  )
}

/** A table-shaped skeleton -- `columns` matches the real table's <thead>
 * column count so the loading state doesn't visually jump once data
 * arrives. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-[var(--border)]">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={cn('h-4', c === 0 ? 'w-3/4' : 'w-2/3')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** A chart-shaped skeleton (axis baseline + varied-height bars) so a
 * loading chart reads as "a chart is coming", not "this is broken". */
export function ChartSkeleton({ className }: { className?: string }) {
  const heights = [40, 70, 55, 85, 60, 45, 75]
  return (
    <div className={cn('flex h-full items-end gap-2 px-2 pb-4', className)}>
      {heights.map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-16" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-24" />
      ))}
    </div>
  )
}

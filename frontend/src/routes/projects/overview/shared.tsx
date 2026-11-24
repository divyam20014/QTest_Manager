import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'

import { isForbidden } from '@/api/client'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { ChartSkeleton, Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'

// ADR-123: building blocks shared by the project Overview widgets. Every widget has a title, a
// "View" link to the records behind it, and loading / empty / error states that never take the
// rest of the page down.

/** A widget's data depends on who is looking (project scope, Tester case scope), so the cache is per user. */
export function useOverviewQuery<T>(
  projectId: string,
  key: unknown[],
  fn: () => Promise<T>,
  enabled = true,
): UseQueryResult<T> {
  const userId = useAuth().user?.user_id ?? 'anon'
  return useQuery({
    queryKey: ['projects', projectId, 'overview', userId, ...key],
    queryFn: fn,
    enabled,
    staleTime: 15_000,
    // A refusal (Reports hidden from this role) is final; anything else gets one retry.
    retry: (count, error) => !isForbidden(error) && count < 1,
  })
}

export function ViewLink({ to, title, label = 'View' }: { to: string; title: string; label?: string }) {
  return (
    <Link
      to={to}
      aria-label={`${label} ${title}`}
      className="inline-flex items-center rounded-md px-1.5 text-xs font-medium text-[var(--link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11 max-md:text-sm"
    >
      {label}
    </Link>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 py-4 text-center text-sm text-[var(--muted-foreground)]">{children}</p>
}

function WidgetError({ q, title }: { q: UseQueryResult<unknown>; title: string }) {
  if (isForbidden(q.error)) {
    return (
      <Note>
        <span data-testid="widget-forbidden">Not available for your role in this workspace.</span>
      </Note>
    )
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-1 py-3 text-center">
      <p className="text-sm font-medium text-[var(--status-serious)]">{title} could not load</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>
        Retry
      </Button>
    </div>
  )
}

/** Loading / error / content for one query. */
export function Async<T>({
  q,
  title,
  chart,
  children,
}: {
  q: UseQueryResult<T>
  title: string
  chart?: boolean
  children: (data: T) => ReactNode
}) {
  if (q.isError) return <WidgetError q={q} title={title} />
  if (q.isPending || q.data === undefined) {
    return (
      <div role="status">
        <span className="sr-only">Loading {title}</span>
        {chart ? <ChartSkeleton /> : <Skeleton className="h-20 w-full" />}
      </div>
    )
  }
  return <>{children(q.data)}</>
}

/** Card for the widgets that are not charts: title, optional View link, body. */
export function WidgetFrame({
  testId,
  title,
  view,
  children,
  className,
}: {
  testId: string
  title: string
  view?: { to: string; label?: string }
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <EmbossedCard className={`h-full ${className ?? ''}`} data-testid={testId} role="region" aria-labelledby={id}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
        <CardTitle id={id} className="text-sm">
          {title}
        </CardTitle>
        {view && <ViewLink to={view.to} title={title} label={view.label} />}
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </EmbossedCard>
  )
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[var(--muted)] px-3 py-2">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  )
}

export interface BarRow {
  label: string
  value: number
  display?: string
  color: string
  to?: string
}

/** Horizontal bars: label (a link when `to` is given), bar, value. Colour is decoration; the value is always text. */
export function BarRows({ rows, unit, max }: { rows: BarRow[]; unit: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex flex-col gap-1.5" aria-label={unit}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_3.25rem] items-center gap-2 text-xs">
          {r.to ? (
            <Link to={r.to} className="inline-flex items-center truncate hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:min-h-11" title={r.label}>
              {r.label}
            </Link>
          ) : (
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
          )}
          <span className="h-2 rounded-full bg-[var(--muted)]" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, (r.value / top) * 100)}%`, background: r.color }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{r.display ?? r.value}</span>
        </li>
      ))}
    </ul>
  )
}

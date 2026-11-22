import type { FilterTab } from '@/components/ui/filter-tabs'

/**
 * Builds the status tab strip of a list page from a status order and the
 * per-status counts the server returned. A count is left undefined until
 * `ready`, so the tabs never flash zeros while loading. `total` feeds "All".
 */
export function buildStatusTabs({
  order,
  counts,
  total,
  ready,
  labels = {},
  allLabel = 'All',
}: {
  order: readonly string[]
  counts: Record<string, number | undefined>
  total: number | undefined
  ready: boolean
  labels?: Record<string, string>
  allLabel?: string
}): FilterTab[] {
  return [
    { key: '', label: allLabel, count: ready ? total : undefined },
    ...order.map((key) => ({
      key,
      label: labels[key] ?? key,
      count: ready ? (counts[key] ?? 0) : undefined,
    })),
  ]
}

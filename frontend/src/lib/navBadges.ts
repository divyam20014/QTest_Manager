/** Open defects = everything not Closed (same definition as the dashboard backlog). */
export function openDefectCount(status: { counts: Record<string, number>; total: number } | undefined): number {
  if (!status) return 0
  return Math.max(0, status.total - (status.counts['Closed'] ?? 0))
}

/** Badge text: hidden at 0, capped at "99+". */
export function navBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

/** Screen-reader name for a nav item that carries a count, e.g. "Defects, 12 open". */
export function navBadgeLabel(label: string, count: number, noun = 'open'): string {
  return navBadgeText(count) ? `${label}, ${count} ${noun}` : label
}

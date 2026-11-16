// Shared by the Dashboard page and its lazily loaded charts.
export const chartTooltipStyle = {
  background: 'var(--tactile-surface-raised)',
  border: 'none',
  borderRadius: 10,
  boxShadow: 'var(--elevation-raised-sm)',
  fontSize: 12,
  color: 'var(--foreground)',
}

// ISO dates ("2026-11-15") parsed as local midnight so the label never
// slips a day in timezones behind UTC.
export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}
export function shortDay(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
export function longDay(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

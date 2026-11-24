// ADR-124: calendar date maths on plain YYYY-MM-DD strings (UTC, like the due dates and "today" of
// ADR-123), so a date never shifts with the viewer's time zone. Weeks start on Monday.

const DAY_MS = 86_400_000

export function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function msOf(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

export function addDays(iso: string, n: number): string {
  return isoOf(msOf(iso) + n * DAY_MS)
}

/** `YYYY-MM` for any date or month value; null when it is not one. */
export function parseMonth(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100 ? value : null
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + delta
  return isoOf(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1)).slice(0, 7)
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The 42 days (six Monday-first weeks) that show `month`, including the neighbours' edge days. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const start = addDays(first, -weekday)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** Date range to request for a month: its whole grid. */
export function gridRange(month: string): { from: string; to: string } {
  const grid = monthGrid(month)
  return { from: grid[0], to: grid[grid.length - 1] }
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Date + time, in the viewer's locale. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return '\u2014'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Date only, in the viewer's locale (list columns; the detail page shows the time too). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** Rule windows are stored and enforced in UTC (server clock). The UI shows the
 * viewer's local time with an explicit timezone label, plus the UTC instant, so
 * nobody has to guess which clock a freeze follows. */
export function formatRuleInstant(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const local = date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  const utc = `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return local.endsWith('UTC') ? local : `${local} (${utc})`
}

/** `<input type="datetime-local">` value (local wall time) from a UTC instant. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A UTC ISO instant from a datetime-local value (interpreted as local time). */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Stop-clock formatting shared by the Execution Console (BRD FR-EXEC-03):
 * `MM:SS`, growing to `H:MM:SS` once an hour is reached. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The same clock in words, for screen readers ("2 minutes 5 seconds"). */
export function describeClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (hours > 0) parts.push(part(hours, 'hour'))
  if (hours > 0 || minutes > 0) parts.push(part(minutes, 'minute'))
  parts.push(part(seconds, 'second'))
  return parts.join(' ')
}

/** A recorded duration in milliseconds as a clock; sub-second durations keep
 * their millisecond precision (the server records them to the millisecond). */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return formatClock(ms / 1000)
}

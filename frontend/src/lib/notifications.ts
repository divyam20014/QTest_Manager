import type { Notification } from '@/api/notifications'

/** Bell badge text: hidden at 0, capped at "9+" so it never outgrows the icon. */
export function bellBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count > 9 ? '9+' : String(Math.floor(count))
}

/** Accessible name of the bell, which announces the unread count. */
export function bellLabel(count: number): string {
  const badge = bellBadgeText(count)
  return badge ? `Notifications, ${badge} unread` : 'Notifications'
}

const ENTITY_PATH: Partial<Record<Notification['entity_type'], string>> = {
  test_case: '/test-cases',
  defect: '/defects',
  test_run: '/test-runs',
  // execution_step has no detail route of its own, so it is shown as plain text.
}

/** Where a notification leads, or null when its entity has no page. */
export function notificationHref(n: Pick<Notification, 'entity_type' | 'entity_id'>): string | null {
  const base = ENTITY_PATH[n.entity_type]
  return base ? `${base}/${n.entity_id}` : null
}

/** "5m ago" style age, falling back to a date after a week. `now` is injectable for tests. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(then).toLocaleDateString()
}

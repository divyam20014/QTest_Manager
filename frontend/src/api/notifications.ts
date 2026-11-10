import { apiFetch } from '@/api/client'

export type NotificationType = 'mention' | 'test_case_assigned' | 'defect_closed'
export type NotificationEntityType = 'test_case' | 'defect' | 'execution_step'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  body: string
  entity_type: NotificationEntityType
  entity_id: string
  read_at: string | null
  created_at: string
}

export function listNotifications(unreadOnly = false): Promise<Notification[]> {
  const params = unreadOnly ? '?unread_only=true' : ''
  return apiFetch<Notification[]>(`/notifications${params}`)
}

export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/notifications/unread-count')
}

export function markNotificationRead(id: string): Promise<Notification> {
  return apiFetch<Notification>(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead(): Promise<{ marked_count: number }> {
  return apiFetch<{ marked_count: number }>('/notifications/mark-all-read', { method: 'POST' })
}

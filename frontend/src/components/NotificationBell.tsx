import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '@/api/notifications'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { bellBadgeText, bellLabel, notificationHref, timeAgo } from '@/lib/notifications'
import { cn } from '@/lib/utils'

// Phase 9 (AI/SaaS vision roadmap, GAP-74/PV-9.2): a bounded set of
// trigger events (comment mention, test case assignment, defect closure),
// not a generic configurable-rules engine. Polls on a short interval
// rather than a push channel (WebSocket/SSE) -- simplest thing that works
// for this phase's scope; nothing here asked for live push delivery.
//
// Read state lives on the server per user (read_at), so "unread" follows the
// user across devices; the list is already scoped to the signed-in user.
const POLL_INTERVAL_MS = 30_000

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: POLL_INTERVAL_MS,
  })
  const listQuery = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => listNotifications(),
    enabled: open,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  useEffect(() => {
    if (!open) return undefined
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleClick(n: Notification) {
    if (n.read_at === null) markReadMutation.mutate(n.id)
    const href = notificationHref(n)
    if (href) {
      navigate(href)
      setOpen(false)
    }
  }

  const unreadCount = unreadQuery.data?.count ?? 0
  const badge = bellBadgeText(unreadCount)
  const items = listQuery.data ?? []

  return (
    <div ref={ref} className="relative">
      <IconButton
        ref={triggerRef}
        aria-label={bellLabel(unreadCount)}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="relative"
      >
        <Bell />
        {badge && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[11px] font-medium leading-4 text-[var(--destructive-foreground)]"
          >
            {badge}
          </span>
        )}
      </IconButton>
      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-full z-[var(--z-overlay)] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--background)] p-3 shadow-md"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                Mark all read
              </button>
            )}
          </div>
          {listQuery.isPending ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading notifications">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : listQuery.isError ? (
            <div role="alert" className="flex flex-col items-start gap-1 text-sm">
              <p className="text-[var(--muted-foreground)]">Could not load notifications.</p>
              <button
                type="button"
                className="text-xs underline underline-offset-2 max-md:min-h-11"
                onClick={() => listQuery.refetch()}
              >
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">You are all caught up.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full rounded-md p-2 text-left text-sm hover:bg-[var(--muted)]',
                      'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]',
                      n.read_at === null && 'bg-[var(--muted)]/50',
                    )}
                  >
                    <p className="font-medium">
                      {n.read_at === null && <span className="sr-only">Unread: </span>}
                      {n.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{timeAgo(n.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

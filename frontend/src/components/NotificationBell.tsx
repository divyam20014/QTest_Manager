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
import { Button } from '@/components/ui/button'

// Phase 9 (AI/SaaS vision roadmap, GAP-74/PV-9.2): a bounded set of
// trigger events (comment mention, test case assignment, defect closure),
// not a generic configurable-rules engine. Polls on a short interval
// rather than a push channel (WebSocket/SSE) -- simplest thing that works
// for this phase's scope; nothing here asked for live push delivery.
const POLL_INTERVAL_MS = 30_000

const ENTITY_LINK: Partial<Record<Notification['entity_type'], (id: string) => string>> = {
  test_case: (id) => `/test-cases/${id}`,
  defect: (id) => `/defects/${id}`,
  test_run: (id) => `/test-runs/${id}`,
  // execution_step has no direct detail route of its own (it's reached via
  // a test-run-case id, which the notification doesn't carry) -- shown as
  // plain text instead of a broken link.
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
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
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleClick(n: Notification) {
    if (n.read_at === null) markReadMutation.mutate(n.id)
    const toUrl = ENTITY_LINK[n.entity_type]
    if (toUrl) {
      navigate(toUrl(n.entity_id))
      setOpen(false)
    }
  }

  const unreadCount = unreadQuery.data?.count ?? 0

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--destructive)] text-[10px] font-medium text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md border border-[var(--border)] bg-[var(--background)] p-3 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                Mark all read
              </button>
            )}
          </div>
          {(listQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No new notifications.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {listQuery.data?.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`w-full rounded-md p-2 text-left text-sm hover:bg-[var(--muted)] ${
                      n.read_at === null ? 'bg-[var(--muted)]/50' : ''
                    }`}
                  >
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{n.body}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
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
